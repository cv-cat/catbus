"""Use the local discord-cli Python reference to generate offline request fixtures.

Run with that project's development Python. DISCORD_CLI_REFERENCE can point at
another checkout with the same digests listed in the adapter's UPSTREAM file.
"""
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import catbus_golden as g

reference = Path(os.environ.get('DISCORD_CLI_REFERENCE', g.ROOT.parent / 'discord-cli'))
sys.path.insert(0, str(reference.resolve()))
g._patch_random()
g._patch_clock()
g._patch_curl_cffi()

from discord_cli import api, client_context, fidelity
from discord_cli.device import ClientUUIDGenerator
from discord_cli.remote_auth import exchange_remote_auth_ticket

out = g.ROOT / 'tests/golden/discord'
out.mkdir(parents=True, exist_ok=True)
TOKEN = 'synthetic-discord-token'
U, C, M, G = '1001', '2002', '3003', '4004'
IDENTITY = dict(os='Mac OS X', arch='arm64', release='25.0.0', locale='en-US', timezone='UTC', launchId='0123456789abcdef0123456789abcdef')
ME = dict(id=U, username='example', global_name='测试账号')
CHANNEL = dict(id=C, guild_id=G, type=0, name='general')
MESSAGE = dict(id=M, channel_id=C, content='你好 Discord', author=ME, timestamp='2026-10-25T12:00:00Z', attachments=[])


def run(fn, token=TOKEN):
    transport = api.ImpersonateHTTPTransport()
    client = api.DiscordClient(token=token, transport=transport, max_attempts=1)
    context = client_context.ClientContext(client_launch_id=IDENTITY['launchId'])
    context.apply(client)
    api._nonce_last_ms = -1
    api._nonce_sequence = 0
    try:
        with patch.object(fidelity, 'os_name', return_value=IDENTITY['os']), \
             patch.object(fidelity, 'os_arch', return_value=IDENTITY['arch']), \
             patch.object(fidelity._platform, 'release', return_value=IDENTITY['release']), \
             patch('locale.getlocale', return_value=('en_US', 'UTF-8')), \
             patch.object(context, 'request_headers', side_effect=lambda: fidelity.request_headers(
                 context.super_properties(), locale=IDENTITY['locale'], timezone=IDENTITY['timezone'],
                 fingerprint=context.fingerprint, installation_id=context.installation_id)):
            context.apply(client)
            return fn(client, context)
    finally:
        transport.close()


def reply(req):
    method = req['method']
    url = urlsplit(req['url'])
    if url.hostname != 'discord.com':
        return {'status': 200, 'body': b'example' if method == 'GET' else b''}
    path = url.path.removeprefix('/api/v9')
    if path == '/users/@me':
        return ME
    if path == f'/users/{U}/profile':
        return {'user': ME, 'user_profile': {'bio': 'example bio'}}
    if path == '/users/@me/settings':
        return {'theme': 'dark'}
    if path == '/users/@me/guilds':
        return [{'id': G, 'name': 'guild'}]
    if path == f'/guilds/{G}':
        return {'id': G, 'name': 'guild'}
    if path == f'/guilds/{G}/channels':
        return [CHANNEL] if method == 'GET' else CHANNEL
    if path == '/users/@me/channels':
        return [CHANNEL] if method == 'GET' else CHANNEL
    if path == f'/channels/{C}':
        return CHANNEL if method != 'DELETE' else {'status': 204, 'body': ''}
    if path == f'/channels/{C}/messages/{M}':
        return MESSAGE if method != 'DELETE' else {'status': 204, 'body': ''}
    if path == f'/channels/{C}/messages':
        return [MESSAGE] if method == 'GET' else MESSAGE
    if path == f'/channels/{C}/messages/pins':
        return {'items': [{'message': MESSAGE}], 'has_more': False}
    if method == 'GET' and '/reactions/' in path:
        return [ME]
    if path == f'/channels/{C}/messages/{M}/ack':
        return {'token': 'synthetic-ack-token'}
    if path == '/gateway':
        return {'url': 'wss://gateway.discord.gg/'}
    if path == f'/channels/{C}/attachments':
        return {'attachments': [{'id': '0', 'upload_url': 'https://cdn.discordapp.com/synthetic-upload', 'upload_filename': 'fake.txt'}]}
    return {'status': 204, 'body': ''}


def reads(c, _):
    return [c.me(), c.profile(U), c.user_settings(), c.dm_channels(), c.guilds(), c.guild(G), c.guild_channels(G), c.channel(C),
            c.messages(C, before='9000'), c.message(C, M), c.pinned_messages(C), c.reactions(C, M, '👍'), c.gateway()]


def changes(c, _):
    return [c.edit_message(C, M, '编辑'), c.delete_message(C, M), c.delete_messages_bulk(C, [M, '3004']),
            c.ack_channel(C, M), c.ack_channel(C, M), c.typing(C), c.pin_message(C, M), c.unpin_message(C, M),
            c.reaction(C, M, 'cat:123'), c.reaction(C, M, 'cat:123', add=False), c.reaction_delete_user(C, M, '👍', U),
            c.reactions_clear(C, M, '👍'), c.reactions_clear(C, M),
            c.relationship_add(U), c.relationship_add_username('someone', discriminator='1234'), c.relationship_delete(U),
            c.relationship_accept(U), c.relationship_block(U), c.relationship_unblock(U), c.guild_leave(G),
            c.create_guild_channel(G, 'new', topic='主题', parent_id='6006', position=2),
            c.edit_channel(C, name='rename', topic=''), c.delete_channel(C), c.logout()]


def login(c, ctx):
    with TemporaryDirectory() as folder:
        conf = Path(folder) / 'config.json'
        client_context.initialize_context(c, ctx, conf)
        client_context.location_metadata_preflight(c)
        try:
            c.login('synthetic@example.test', 'fake-password')
        except api.AuthenticationRequired:
            c.login_totp('fake-ticket', '123456')
        client_context.clear_fingerprint(ctx, conf)
        return c.me()


def login_reply(req):
    path = urlsplit(req['url']).path
    if path.endswith('/experiments'):
        return {'fingerprint': 'fake-fingerprint', 'installation': 'fake-installation'}
    if path.endswith('/auth/location-metadata'):
        return {'country_code': 'US'}
    if path.endswith('/auth/login'):
        return {'mfa': True, 'ticket': 'fake-ticket', 'allowed_methods': ['totp'], 'login_instance_id': 'fake-instance'}
    if path.endswith('/auth/mfa/totp'):
        return {'token': TOKEN}
    if path.endswith('/remote-auth/login'):
        return {'encrypted_token': 'synthetic-encrypted-token'}
    return ME


for name, fn in [
    ('reads', reads), ('changes', changes),
    ('reply', lambda c, _: c.send_message(C, '你好 Discord', message_reference=c.reply_reference(C, M))),
    ('dm_send', lambda c, _: c.send_message(c.create_dm(U)['id'], '你好 Discord')),
    ('download', lambda c, _: c._download('https://cdn.discordapp.com/fake.txt').data),
]:
    g.case(out, name, lambda fn=fn: run(fn), input=IDENTITY, respond=reply)
with TemporaryDirectory() as folder:
    file = Path(folder) / 'fake.txt'
    file.write_bytes(b'example')
    g.case(out, 'upload', lambda: run(lambda c, _: c.upload_attachment(C, file, '附件')), input=IDENTITY, respond=reply)
g.case(out, 'password_mfa', lambda: run(login, token=None), input=IDENTITY, respond=login_reply)
g.case(out, 'qr_exchange', lambda: run(lambda c, _: exchange_remote_auth_ticket(c, 'fake-ticket'), token=None), input=IDENTITY, respond=login_reply)
g.case(out, 'device_uuid', lambda: ClientUUIDGenerator(rand=g.r).generate(U), input=IDENTITY)
