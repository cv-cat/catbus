"""core 的对拍数据：随机数序列、Python 编码函数（urlencode / quote / json.dumps）、curl_cffi 的 URL 拼接。"""

import json
import random
import secrets
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import quote, quote_plus, urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import catbus_golden as g  # noqa: E402

out = g.setup('core', 'BilibiliApis')

STRINGS = ['abc', 'a b&c=d', '中文 ✓', "!'()*~-_.", 'emoji 😀', 'q=/?#[]@', 'tab\tnl\n"quote"\\', '', 'x+y%z', '\x7f\x01']


def encoding():
    return {
        'strings': STRINGS,
        'quote': [quote(s) for s in STRINGS],
        'quote_safe': [quote(s, safe=':/?=&') for s in STRINGS],
        'quote_plus': [quote_plus(s) for s in STRINGS],
        'urlencode': urlencode([('k' + str(i), s) for i, s in enumerate(STRINGS)] + [('n', 1), ('f', 1.5), ('t', True), ('none', None)]),
        'dumps': [json.dumps(s) for s in STRINGS],
        'dumps_utf8': [json.dumps(s, ensure_ascii=False) for s in STRINGS],
        'dumps_obj': json.dumps({'a': [1, 2.5, None, True], '中': {'k': '值'}, 'e': []}),
        'dumps_compact': json.dumps({'a': [1, 2.5, None, True], '中': {'k': '值'}}, separators=(',', ':')),
    }


def rand():
    return {
        'random': [random.random() for _ in range(3)],
        'randint': [random.randint(1, 100) for _ in range(5)],
        'choice': ''.join(random.choice('abcdef0123') for _ in range(10)),
        'sample': random.sample(range(20), 5),
        'uniform': random.uniform(2, 5),
        'shuffle': (lambda x: (random.shuffle(x), x)[1])(list(range(8))),
        'hex': secrets.token_hex(8),
        'uuid': str(uuid.uuid4()),
        'time': time.time(),
        'int_time': int(time.time()),
    }


def curl_urls():
    from curl_cffi.requests import utils as cu
    base = 'https://api.example.com/x/y?a=1&b=2'
    cases = [
        (base, {'b': 3, 'c': 'x y', 'd': True}),
        ('https://api.example.com/p', [('k', '中文'), ('k', 'v2'), ('e', '')]),
        ('https://api.example.com/p?q=%E4%B8%AD', {'z': "!'()*"}),
        ('https://api.example.com/a|b', {}),
    ]
    urls = []
    for url, params in cases:
        u = cu.update_url_params(url, params) if params else url
        urls.append(cu.requote_uri(u))
    return {'cases': [[u, list(p.items()) if isinstance(p, dict) else p] for u, p in cases], 'urls': urls}


g.case(out, 'encoding', encoding)
g.case(out, 'rand', rand)
g.case(out, 'curl_urls', curl_urls)
