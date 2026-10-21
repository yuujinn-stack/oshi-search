#!/usr/bin/env python3
"""価格更新専用ユーザー（price_refresher）のパスワードを作り、画面・Git・Neon の履歴に出さずに使えるようにする。

  python3 -I scripts/price-refresh/make-role-password.py

  1. 64桁（256ビット）のランダムなパスワードを作る（画面には出さない）。
  2. .env.local の DATABASE_URL のユーザー名・パスワードだけを置き換えた接続文字列を
     .env.price-refresh.local（Git 管理外・自分だけ読み書きできる権限）に保存する。
     → GitHub の Secrets「PRICE_REFRESH_DATABASE_URL」と、設定後の権限の確認に使う。
  3. Neon の SQL Editor に貼る SQL を tmp/price-refresh-role.sql（Git 管理外）に書き出す。
     パスワードは PostgreSQL 標準の SCRAM-SHA-256 のハッシュ（PostgreSQL がパスワードを保存するときと同じ形）で書くため、
     SQL Editor の履歴にもパスワードそのものは残らない。
     （万一 Neon がハッシュでの指定を受け付けない場合に備え、パスワードをそのまま書いた版も
      tmp/price-refresh-role.plain.sql に書き出す。こちらは必要なときだけ使い、使ったら消す）

既にファイルがある場合は上書きしない（作り直すときは自分で消してから実行する）。標準ライブラリだけを使う。
"""
import base64
import hashlib
import hmac
import os
import re
import secrets
import sys
from urllib.parse import urlsplit, urlunsplit

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ENV_LOCAL = os.path.join(ROOT, '.env.local')
ENV_OUT = os.path.join(ROOT, '.env.price-refresh.local')
SQL_OUT = os.path.join(ROOT, 'tmp', 'price-refresh-role.sql')
SQL_PLAIN_OUT = os.path.join(ROOT, 'tmp', 'price-refresh-role.plain.sql')
RUNBOOK = os.path.join(ROOT, 'docs', 'price-refresh-runbook.md')
ROLE = 'price_refresher'
PLACEHOLDER = "'<自分で生成したパスワード>'"


def scram_sha256_verifier(password: str, salt: bytes | None = None, iterations: int = 4096) -> str:
    """PostgreSQL の pg_authid.rolpassword と同じ形式（SCRAM-SHA-256$<反復>:<salt>$<StoredKey>:<ServerKey>）"""
    salt = salt if salt is not None else secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
    client_key = hmac.new(salted, b'Client Key', hashlib.sha256).digest()
    stored_key = hashlib.sha256(client_key).digest()
    server_key = hmac.new(salted, b'Server Key', hashlib.sha256).digest()
    b64 = lambda b: base64.b64encode(b).decode('ascii')
    return f'SCRAM-SHA-256${iterations}:{b64(salt)}${b64(stored_key)}:{b64(server_key)}'


def read_database_url(path: str) -> str:
    with open(path, encoding='utf-8') as f:
        for line in f:
            m = re.match(r'^\s*DATABASE_URL\s*=\s*(.+?)\s*$', line)
            if m:
                return m.group(1).strip().strip('"').strip("'")
    raise SystemExit('.env.local に DATABASE_URL が見つかりません')


def role_sql_from_runbook(password_literal: str) -> str:
    with open(RUNBOOK, encoding='utf-8') as f:
        text = f.read()
    blocks = re.findall(r'```sql\n(.*?)```', text, re.S)
    if not blocks or PLACEHOLDER not in blocks[0]:
        raise SystemExit('手順書の SQL が見つかりません')
    return blocks[0].replace(PLACEHOLDER, password_literal)


def write_private(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        f.write(content)


def main() -> None:
    for p in (ENV_OUT, SQL_OUT, SQL_PLAIN_OUT):
        if os.path.exists(p):
            raise SystemExit(f'{os.path.relpath(p, ROOT)} が既にあります（作り直す場合は消してから実行してください）')
    owner_url = read_database_url(ENV_LOCAL)
    parts = urlsplit(owner_url)
    if not parts.hostname or parts.username is None:
        raise SystemExit('DATABASE_URL の形式を読み取れません')
    password = secrets.token_hex(32)  # 英数字だけ（接続文字列でエスケープ不要）
    host = parts.hostname + (f':{parts.port}' if parts.port else '')
    url = urlunsplit((parts.scheme, f'{ROLE}:{password}@{host}', parts.path, parts.query, parts.fragment))
    write_private(ENV_OUT, f'# 価格更新専用ユーザー（{ROLE}）の接続文字列。Git 管理外。共有しない。\nDATABASE_URL={url}\n')
    write_private(SQL_OUT, role_sql_from_runbook("'" + scram_sha256_verifier(password) + "'"))
    write_private(SQL_PLAIN_OUT, role_sql_from_runbook("'" + password + "'"))
    print('作成しました（パスワード・接続文字列は表示していません）:')
    print(f'  {os.path.relpath(ENV_OUT, ROOT)}  … 価格更新専用ユーザーの接続文字列（GitHub の Secrets・権限の確認に使う）')
    print(f'  {os.path.relpath(SQL_OUT, ROOT)}  … Neon の SQL Editor に貼る SQL（パスワードはハッシュ）')
    print(f'  {os.path.relpath(SQL_PLAIN_OUT, ROOT)}  … 予備（ハッシュが使えない場合だけ。使わなければ消す）')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--verifier-for-test':
        # テスト用：python3 make-role-password.py --verifier-for-test <password> <salt_b64> <iterations>
        print(scram_sha256_verifier(sys.argv[2], base64.b64decode(sys.argv[3]), int(sys.argv[4])))
    else:
        main()
