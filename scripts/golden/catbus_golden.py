"""对拍数据生成框架（AGENTS 7.5）。

在上游 Python 代码外面套一层：
- 随机数与时钟换成确定性的序列，推导公式与 src/core/rand.ts 一一对应；
- curl_cffi / requests 的请求被截获，不发网络，按用例给的响应顺序返回；
- 上游用 subprocess / PyExecJS 起的 node 进程，通过 NODE_OPTIONS 预加载
  node_determinism.cjs，同样固定 Math.random 与 Date。

用法见 scripts/golden/<p>/gen.py。输出写到 tests/golden/<p>/<case>.json，只能用假凭证。
"""

from __future__ import annotations

import base64
import datetime as _dt
import json
import os
import random
import secrets
import sys
import time
import traceback
import uuid
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[2]
SEED = 20260927
NOW_MS = 1790000000123

# --------------------------------------------------------------------------- 随机数


def mulberry32(seed: int) -> Callable[[], float]:
    """与 src/core/rand.ts 的 mulberry32 逐位相同."""
    state = [seed & 0xFFFFFFFF]

    def imul(a: int, b: int) -> int:
        return (a * b) & 0xFFFFFFFF

    def nxt() -> float:
        a = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        state[0] = a
        t = imul(a ^ (a >> 15), a | 1)
        t = ((t + imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return nxt


_source: list[Callable[[], float]] = [mulberry32(SEED)]


def r() -> float:
    return _source[0]()


def _randint(self, a, b):
    return a + int(r() * (b - a + 1))


def _randrange(self, start, stop=None, step=1):
    if stop is None:
        start, stop = 0, start
    n = (stop - start + step - 1) // step if step > 0 else (start - stop - step - 1) // -step
    return start + step * int(r() * n)


def _choice(self, seq):
    return seq[int(r() * len(seq))]


def _choices(self, population, weights=None, *, cum_weights=None, k=1):
    population = list(population)
    if weights is None and cum_weights is None:
        return [population[int(r() * len(population))] for _ in range(k)]
    if cum_weights is None:
        acc, cum_weights = 0, []
        for w in weights:
            acc += w
            cum_weights.append(acc)
    total = cum_weights[-1]
    out = []
    for _ in range(k):
        x = r() * total
        out.append(population[next(i for i, c in enumerate(cum_weights) if x < c)])
    return out


def _uniform(self, a, b):
    return a + (b - a) * r()


def _sample(self, population, k, *, counts=None):
    pool = list(population)
    for i in range(k):
        j = i + int(r() * (len(pool) - i))
        pool[i], pool[j] = pool[j], pool[i]
    return pool[:k]


def _shuffle(self, x):
    for i in range(len(x) - 1, 0, -1):
        j = int(r() * (i + 1))
        x[i], x[j] = x[j], x[i]


def _getrandbits(self, k):
    out, shift = 0, 0
    while k > 0:
        bits = min(k, 32)
        out |= int(r() * (1 << bits)) << shift
        shift += bits
        k -= bits
    return out


def _urandom(n: int) -> bytes:
    return bytes(int(r() * 256) for _ in range(n))


def _patch_random() -> None:
    for cls in (random.Random, random.SystemRandom):
        cls.random = lambda self: r()
        cls.randint = _randint
        cls.randrange = _randrange
        cls.choice = _choice
        cls.choices = _choices
        cls.uniform = _uniform
        cls.sample = _sample
        cls.shuffle = _shuffle
        cls.getrandbits = _getrandbits
        cls.randbytes = lambda self, n: _urandom(n)
    # 模块级函数是隐藏实例的绑定方法，重新绑定一次
    inst = random._inst  # type: ignore[attr-defined]
    for name in ('random', 'randint', 'randrange', 'choice', 'choices', 'uniform', 'sample', 'shuffle', 'getrandbits', 'randbytes'):
        setattr(random, name, getattr(inst, name))
    os.urandom = _urandom
    secrets.token_bytes = lambda n=32: _urandom(n)
    secrets.token_hex = lambda n=32: _urandom(n).hex()
    secrets.token_urlsafe = lambda n=32: base64.urlsafe_b64encode(_urandom(n)).rstrip(b'=').decode()
    secrets.choice = lambda seq: seq[int(r() * len(seq))]
    secrets.randbelow = lambda n: int(r() * n)
    uuid.uuid4 = lambda: uuid.UUID(bytes=_urandom(16), version=4)


# --------------------------------------------------------------------------- 时钟


class _FixedDateTime(_dt.datetime):
    @classmethod
    def now(cls, tz=None):
        base = _dt.datetime.fromtimestamp(NOW_MS / 1000, tz=_dt.timezone.utc)
        return base.astimezone(tz) if tz else base.astimezone().replace(tzinfo=None)

    @classmethod
    def utcnow(cls):
        return _dt.datetime.fromtimestamp(NOW_MS / 1000, tz=_dt.timezone.utc).replace(tzinfo=None)

    @classmethod
    def today(cls):
        return cls.now()


def _patch_clock() -> None:
    time.time = lambda: NOW_MS / 1000
    time.time_ns = lambda: NOW_MS * 1_000_000
    _dt.datetime = _FixedDateTime  # type: ignore[misc]
    time.sleep = lambda s: None


def _patch_node() -> None:
    preload = (ROOT / 'scripts' / 'golden' / 'node_determinism.cjs').as_posix()
    os.environ['NODE_OPTIONS'] = f'--require "{preload}"'
    os.environ['CATBUS_GOLDEN_SEED'] = str(SEED)
    os.environ['CATBUS_GOLDEN_NOW'] = str(NOW_MS)


# --------------------------------------------------------------------------- 请求截获


class FakeResponse:
    """够上游代码用的响应对象，curl_cffi 与 requests 共用."""

    def __init__(self, url: str, status: int = 200, headers: dict | None = None, body: Any = None):
        self.url = url
        self.status_code = status
        self.ok = 200 <= status < 400
        self.reason = 'OK'
        self.encoding = 'utf-8'
        self.headers = _CIDict(headers or {})
        if isinstance(body, (dict, list)):
            self.content = json.dumps(body, ensure_ascii=False).encode()
            self.headers.setdefault('content-type', 'application/json; charset=utf-8')
        elif isinstance(body, str):
            self.content = body.encode()
        else:
            self.content = body or b''
        self.text = self.content.decode('utf-8', errors='replace')
        self.cookies = _cookies_from(self.headers)
        self.history = []
        self.elapsed = _dt.timedelta(0)

    def json(self, **kwargs):
        return json.loads(self.text)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f'HTTP {self.status_code}')

    def iter_content(self, chunk_size=1, *args, **kwargs):
        for i in range(0, len(self.content), chunk_size or len(self.content) or 1):
            yield self.content[i:i + (chunk_size or len(self.content))]

    def close(self):
        pass


class _CIDict(dict):
    def __init__(self, data):
        super().__init__()
        for k, v in data.items():
            self[k] = v

    def __setitem__(self, k, v):
        super().__setitem__(k.lower(), v)

    def __getitem__(self, k):
        return super().__getitem__(k.lower())

    def get(self, k, default=None):
        return super().get(k.lower(), default)

    def setdefault(self, k, default=None):
        return super().setdefault(k.lower(), default)

    def __contains__(self, k):
        return super().__contains__(k.lower())

    def get_list(self, k):
        v = self.get(k)
        return [] if v is None else (v if isinstance(v, list) else [v])


def _cookies_from(headers: _CIDict):
    try:
        from requests.cookies import RequestsCookieJar
        jar = RequestsCookieJar()
    except ImportError:
        jar = _SimpleJar()
    for line in headers.get_list('set-cookie'):
        name, _, rest = line.partition('=')
        jar.set(name.strip(), rest.split(';', 1)[0].strip())
    return jar


class _SimpleJar(dict):
    def set(self, k, v, **kwargs):
        self[k] = v

    def get_dict(self):
        return dict(self)


_captured: list[dict] = []
_responder: list[Callable[[dict], Any]] = [lambda req: {'code': 0, 'data': {}}]
_responses: list[dict] = []


def _encode_body(body: Any) -> Any:
    if body is None or body == b'' or body == '':
        return None
    if isinstance(body, str):
        return body
    try:
        return body.decode('utf-8')
    except UnicodeDecodeError:
        return {'base64': base64.b64encode(body).decode()}


def _split_cookie_headers(pairs: list[tuple[str, str]]) -> tuple[list[list[str]], list[list[str]]]:
    headers, cookies = [], []
    for k, v in pairs:
        if k.lower() == 'cookie':
            for part in v.split(';'):
                part = part.strip()
                if part:
                    name, _, value = part.partition('=')
                    cookies.append([name, value])
        else:
            headers.append([k, v])
    return headers, cookies


def _respond(req: dict) -> FakeResponse:
    _captured.append(req)
    spec = _responder[0](req)
    if isinstance(spec, FakeResponse):
        resp = spec
        spec = {'status': resp.status_code, 'headers': dict(resp.headers), 'body': resp.text}
    elif not (isinstance(spec, dict) and 'body' in spec and set(spec) <= {'status', 'headers', 'body'}):
        spec = {'status': 200, 'headers': {}, 'body': spec}
    spec = {'status': spec.get('status', 200), 'headers': spec.get('headers') or {}, 'body': spec['body']}
    _responses.append(spec)
    return FakeResponse(req['url'], spec['status'], spec['headers'], spec['body'])


def _patch_curl_cffi() -> None:
    try:
        from curl_cffi import requests as cffi
        from curl_cffi.requests import utils as cutils
        from curl_cffi.requests.headers import Headers
    except ImportError:
        return

    def request(self, method, url, params=None, data=None, json=None, headers=None, cookies=None,
                files=None, auth=None, timeout=None, allow_redirects=None, max_redirects=None,
                proxies=None, proxy=None, proxy_auth=None, verify=None, referer=None,
                accept_encoding='gzip, deflate, br, zstd', content_callback=None, impersonate=None,
                ja3=None, akamai=None, extra_fp=None, default_headers=None, default_encoding='utf-8',
                quote='', http_version=None, interface=None, cert=None, stream=None,
                max_recv_speed=0, multipart=None, content=None, **kwargs):
        method = method.upper()
        body_data = content if content is not None else data
        if content is not None:
            body = content.encode() if isinstance(content, str) else bytes(content)
        elif isinstance(data, (dict, list, tuple)):
            from urllib.parse import urlencode
            body = urlencode(data).encode()
        elif isinstance(data, str):
            body = data.encode()
        elif isinstance(data, bytes):
            body = data
        else:
            body = b''
        if json is not None:
            from json import dumps
            body = dumps(json, separators=(',', ':')).encode()

        u = url
        if self.params:
            u = cutils.update_url_params(u, self.params)
        if params:
            u = cutils.update_url_params(u, params)
        if quote:
            u = cutils.quote_path_and_params(u, quote_str=quote)
        if quote is not False:
            u = cutils.requote_uri(u)

        h = Headers(self.headers)
        h.update(headers)
        lines = [(k, v) for k, v in h.multi_items() if v is not None]
        names = {k.lower() for k, _ in lines}
        if json is not None and 'content-type' not in names:
            lines.append(('Content-Type', 'application/json'))
        if content is None and isinstance(data, dict) and method != 'POST' and 'content-type' not in names:
            lines.append(('Content-Type', 'application/x-www-form-urlencoded'))
        if isinstance(body_data, (str, bytes, bytearray)) and body_data and 'content-type' not in names:
            lines.append(('Content-Type', 'application/octet-stream'))
        hdrs, cks = _split_cookie_headers(lines)
        for src in (self.cookies, cookies):
            if not src:
                continue
            items = src.items() if hasattr(src, 'items') else []
            for k, v in items:
                cks.append([k, v])
        mp = None
        if multipart is not None:
            mp = [{'name': p.get('name'), 'filename': p.get('filename'), 'contentType': p.get('content_type'),
                   'data': _encode_body(p.get('data'))} for p in getattr(multipart, '_catbus_parts', [])]
            for k, v in (data or {}).items():
                mp.append({'name': k, 'filename': None, 'contentType': None, 'data': v})
            body = b''
        return _respond({'method': method, 'url': u, 'headers': hdrs, 'cookies': cks,
                         'body': _encode_body(body), 'multipart': mp})

    cffi.Session.request = request

    # CurlMime：记录 addpart 的参数，供 multipart 比较
    try:
        from curl_cffi import CurlMime

        orig_init = CurlMime.__init__
        orig_addpart = CurlMime.addpart

        def init(self, *a, **k):
            orig_init(self, *a, **k)
            self._catbus_parts = []

        def addpart(self, name, *, content_type=None, filename=None, local_path=None, data=None):
            if local_path is not None and data is None:
                data = Path(local_path).read_bytes()
            self._catbus_parts.append({'name': name, 'content_type': content_type, 'filename': filename, 'data': data})
            return orig_addpart(self, name, content_type=content_type, filename=filename, data=data or b'')

        CurlMime.__init__ = init
        CurlMime.addpart = addpart
    except ImportError:
        pass


def _patch_requests() -> None:
    try:
        import requests
    except ImportError:
        return

    def request(self, method, url, params=None, data=None, headers=None, cookies=None, files=None,
                auth=None, timeout=None, allow_redirects=True, proxies=None, hooks=None, stream=None,
                verify=None, cert=None, json=None, **kwargs):
        merged_cookies = dict(self.cookies.get_dict()) if self.cookies else {}
        merged_cookies.update(cookies or {})
        p = requests.Request(method.upper(), url, params=params, data=data, json=json, files=files,
                             headers=headers, cookies=merged_cookies).prepare()
        pairs = [(k, v) for k, v in p.headers.items() if k.lower() != 'content-length']
        hdrs, cks = _split_cookie_headers(pairs)
        return _respond({'method': p.method, 'url': p.url, 'headers': hdrs, 'cookies': cks,
                         'body': _encode_body(p.body), 'multipart': None})

    requests.Session.request = request


# --------------------------------------------------------------------------- 用例


def setup(platform: str, repo: str) -> Path:
    """在导入上游模块之前调用：打补丁，并把上游仓库加进 sys.path."""
    _patch_random()
    _patch_clock()
    _patch_node()
    _patch_curl_cffi()
    _patch_requests()
    upstream = ROOT / 'references' / repo
    sys.path.insert(0, str(upstream))
    os.chdir(upstream)
    out = ROOT / 'tests' / 'golden' / platform
    out.mkdir(parents=True, exist_ok=True)
    return out


def _jsonable(v: Any) -> Any:
    if isinstance(v, (bytes, bytearray)):
        return {'base64': base64.b64encode(bytes(v)).decode()}
    if isinstance(v, tuple):
        return [_jsonable(x) for x in v]
    if isinstance(v, list):
        return [_jsonable(x) for x in v]
    if isinstance(v, dict):
        return {str(k): _jsonable(x) for k, x in v.items()}
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    return repr(v)


def case(out: Path, name: str, fn: Callable[[], Any], *, input: Any = None,
         respond: Callable[[dict], Any] | None = None) -> None:
    """跑一个用例：重置随机数种子，按 respond 回复请求，记录请求序列与返回值."""
    _source[0] = mulberry32(SEED)
    _captured.clear()
    _responses.clear()
    _responder[0] = respond or (lambda req: {'code': 0, 'data': {}})
    error = None
    try:
        result = fn()
    except Exception as e:  # noqa: BLE001 — 上游抛错本身也是对拍的一部分
        result = None
        error = f'{type(e).__name__}: {e}'
        traceback.print_exc()
    data = {
        'input': _jsonable(input),
        'seed': SEED,
        'now': NOW_MS,
        'requests': list(_captured),
        'responses': list(_responses),
        'result': _jsonable(result),
        'error': error,
    }
    (out / f'{name}.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(f'[golden] {out.name}/{name}: {len(_captured)} req{" ERROR " + error if error else ""}', file=sys.stderr)
