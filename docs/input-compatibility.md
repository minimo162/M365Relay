# M365Relay 0.2.2 — 入力照合の修正

## 観測と再現

ユーザーの画像は二つとも、BRIDGE_REQUEST_IDに続くBRIDGE_REQUEST_JSONの先頭「BRID」で止まっていました。
現行プロンプトと36文字の要求IDを合わせると、この位置は最初の3,000 UTF-16 code unitsと一致します。
画像だけで入力欄の上限やDOMそのものを特定したわけではありません。

Linuxの実Chromium 144.0.7559.96で、空のcontenteditableの段落に実CDP Input.insertTextを使って同じ3,000文字を入力しました。
元の読み取り方（innerText）は3,080文字になり、改行の位置で不一致となりました。
新しいDOM読み取りは3,000文字で完全一致しました。M365サービスへは接続していません。

## 変更

- テキスト入力欄はvalueをそのまま読む。contenteditableはテキストノード・段落境界・BRを区別する。
- P/DIV/PREのブロック境界は1個のLF。空の段落の単独BRはカーソル表示用の空行として扱う。
- 文字、空白、空行、タブ、NBSP、Unicodeは省略・置換・trimしない。CRLF/CRのLF正規化だけを両側へ適用する。
- これは入力欄の照合契約です。旧`ARG /content string`は互換上、境界の空白・タブ・CRLFを除去して受理します。先頭・末尾の値を保持するツール引数は`json-string`を使います。
- 想定外の非テキスト要素は停止。プロンプトの内容をJavaScriptとして解釈しない。
- 入力後は最大3秒、100ms間隔で読み直す。200ms以上一致を保った後で次の分割へ進む。再挿入はしない。
- 送信直前の同一DOM操作内でも全文照合する。
- エラーは文字数、差分位置（0始まりUTF-16）、文字種だけを返す。具体的な文字、本文、パス、HTMLは返さない。
- 起動バージョンはpackage.jsonから読み、旧0.2.0の固定表示を修正する。

## 検証

契約テスト68件、実Chromiumを使う入力回帰テスト13件を実行して成功（最終実行は失敗0・skip0）。
後者の内容: 段落/空行、日本語・絵文字・タブ・空白・パス・JSON、value入力欄、正当な欠落/文字変化の拒否、
52,760 UTF-16 unitsを18分割して最後まで入力し送信1回、150msの描画遅延、一致後のDOM巻き戻り、
入力欠落での送信/再挿入拒否、送信直前の変更拒否、本文を含まない診断。
長い入力はテスト環境の合格値であり、実M365の入力上限や受入品質を保証するものではありません。

実ブラウザーのテストはintegration/editor.chromium.mjsです。
`CHROMIUM_PATH=/usr/bin/chromium node --test integration/editor.chromium.mjs`で実行します。
通常の `node --test` ではブラウザー試験を自動実行しません。
ブラウザーとM365の応答は別です。ブラウザー/CDPは実物ですが、画面と回答はテスト用のものです。

初回の統合試験はテスト用HTTPページへのアクセスが実行環境のポリシーで拒否され、試験準備に失敗しました。
ブラウザーポリシーは変更せず、ネットワークアクセスを伴わないabout:blank上のメモリ内画面へ試験を修正しました。
最終13件の結果はその後の実行です。初回一括成功や実M365での成功として扱いません。

## 未確認

実際のM365のDOM、Windows/Edge、VS Codeとの通し動作は未確認です。
モデルがJSONを返す品質、長い依頼のサービス側上限、回答のMarkdown変換などは今回の検証範囲外です。
空白をNBSPへ変えるスタイルの入力欄は黙って同一視せず診断付きで止めます。
異なるDOM構造で止まった場合は、検査を無効にせず、得られた診断を基に対応します。

## 参照（一次資料）

- 旧実装: minimo162/M365Relay @ 08f2b74730b569e222565565ff4e68e86c00e5bb, src/m365.mjs・src/dom.mjs
- MDN, HTMLElement.innerText: https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/innerText
- MDN, Node.textContent: https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent
- Lexical Editor State: https://lexical.dev/docs/concepts/editor-state
