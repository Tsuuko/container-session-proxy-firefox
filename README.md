# Container Session Proxy

Firefox のコンテナごとに異なるプロキシセッション ID を割り当てる拡張です。

Bright Data のように、ユーザー名や URL の一部へ session id を埋め込めるプロキシで使うことを想定しています。固定のプロキシ URL に対して、コンテナごとに生成した `${session}` を差し込みます。

## 必要なもの

- Firefox
- Node.js
- pnpm
- session id を指定できるプロキシ

通常の固定プロキシだけで、接続ごとの session id を URL やユーザー名に指定できないサービスでは、この拡張のコンテナ別セッション機能は使えません。

## インストール

依存関係を入れます。

```bash
pnpm install
```

開発中に一時的に読み込む場合:

```bash
pnpm run dev:firefox
```

ビルドする場合:

```bash
pnpm run build:firefox
```

zip を作る場合:

```bash
pnpm run zip:firefox
```

生成物は `.output/` 以下に出力されます。

## 未署名のまま使う場合

通常リリース版の Firefox では、未署名アドオンを恒久的に使うことはできません。未署名のまま使いたい場合は、Firefox Developer Edition、Nightly、ESR、または Unbranded build など、署名チェックを無効化できる Firefox が必要です。

その上で、Mozilla の案内に沿って `about:config` から `xpinstall.signatures.required` を `false` にしてください。

Mozilla Support:
https://support.mozilla.org/ja/kb/add-on-signing-in-firefox#w_wei-shu-ming-noadoonwoshi-itaichang-he-shang-ji-yu-za-xiang-ke

注意: 署名チェックの無効化はブラウザの安全性に影響します。自分で内容を確認できる拡張だけに使ってください。

## 使い方

1. Firefox のコンテナタブを開きます。
2. 拡張アイコンをクリックします。
3. `Proxy URL template` にプロキシ URL を入力します。
4. `Session template` に session id の作り方を入力します。
5. 必要なオプションを選びます。
6. `Save` を押します。

`Direct for non-container tabs` はデフォルトで ON です。通常タブやプライベートタブなど、Firefox コンテナではないタブでは直接接続します。

## Proxy URL template

プロキシ URL 全体のテンプレートです。`${session}` が、`Session template` から生成されたセッション文字列に置き換わります。

例:

```text
socks5h://brd-customer-example-zone-zone1-session-${session}:password@brd.superproxy.io:22228
```

対応スキーム:

- `http://`
- `https://`
- `socks5://`
- `socks5h://`

`socks5h://` は Firefox の SOCKS プロキシとして扱い、SOCKS 側で DNS 解決します。

## Session template

session id の文字列を組み立てるテンプレートです。

例:

```text
csp_${hash}
```

この場合、コンテナごとの短いハッシュを使って `csp_xxxxxx` のような session id を作ります。

使用できる変数:

- `${hash}`: コンテナ ID とソルトから作る短いハッシュ
- `${hash_long}`: コンテナ ID とソルトから作る長いハッシュ
- `${cookieStoreId}`: Firefox の cookie store ID をテンプレート向けに整形した値
- `${containerId}`: `${cookieStoreId}` と同じ整形済み ID
- `${containerSlug}`: `firefox-` prefix を外して整形した値

`Session template` の結果が `${session}` として `Proxy URL template` に入ります。

## オプション

- `Direct for non-container tabs`: Firefox コンテナではないタブを直接接続にします。
- `Exclude local/private addresses`: localhost、`.local`、プライベート IPv4、ローカル IPv6 をプロキシ対象外にします。
- `Disable WebRTC`: WebRTC peer connection を無効化します。
- `Randomize hash`: ハッシュ用のソルトを変更します。Proxy URL や Session template は変更しません。
- `IP Check`: IP 確認サイトを現在のコンテナで開きます。

## Bright Data の例

Bright Data 形式では、session id はユーザー名側に入れる必要があります。

```text
socks5h://brd-customer-xxxx-zone-zone1-session-${session}:password@brd.superproxy.io:22228
```

`Session template` 側は、サービスが許可する文字だけにしてください。プロキシによってはハイフンが使えず、アンダーバーや英数字のみが安全な場合があります。

## 開発用コマンド

```bash
pnpm run compile
pnpm run dev:firefox
pnpm run build:firefox
pnpm run zip:firefox
```
