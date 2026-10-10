# Playwright Mock DOM tests

## 実行

Node.js 20以上。単体テストはNode標準 `node:test` と `vm` による160件です。
既存127件を維持し、Workのhome formでも同じ回帰テスト33件を実行します。
以前はpackage.jsonがなく、直接Nodeで実行していました。

```sh
npm ci
npx playwright install chromium
npm test
npm run test:browser
npm run test:all
```

- `npm test` / `npm run test:unit`: 従来の単体テストのみ。
- `npm run test:browser`: 本ファイル群のブラウザテスト19件。
- `npm run test:all`: 単体、ブラウザの順に実行。失敗は非0で終了。
- インストール時のみnpm/CDN接続が必要。テスト実行はlocalhostのみ。
- Linux CIでは `npx playwright install --with-deps chromium` を使用できる。
  headlessのためXvfb不要。今回の実測環境はWindows、Node 22.16.0、
  Playwright 1.63.0、付属Chromium 153.0.8010.12。Linux実機は未検証。

## 拡張のロードと設定

[Playwright公式の拡張テスト方式](https://playwright.dev/docs/chrome-extensions)に従い、
付属Chromiumの `channel: 'chromium'`、persistent context、
`--disable-extensions-except`、`--load-extension` を使う。

各テスト専用の一時ディレクトリに、実際のcontent.js、popup.js/html、
アイコン、ロケールをそのままコピーする。本番manifestは読み取りのみ。
一時manifestに限りcontent_scripts.matchesを `http://127.0.0.1/*` に置換し、
設定投入用の小さなservice workerを追加する。本番拡張にはservice workerはない。
このworkerは拡張IDとchrome.storage.localへのアクセス用で、DOM・キー・送信ロジックを持たない。
content scriptの直接evalや代替実装は使用しない。
popupを開いたりactiveTabによる注入を行ったりせず、manifest経由で自動注入させる。

localhost HTTP serverはランダムポートを使う。URLマッピング方式よりも
実サイト由来のURLを使わない構成を選んだ。
fixture以外へのリクエストは中断しテスト失敗、外部DNS解決も遮断する。
認証・実サイト・Store APIを使わず、Cookieを投入しない。
Cookieが空であることも確認する。通常終了・テスト失敗時にはcontextを閉じ、
一時拡張とプロファイルをfinallyで削除する。
プロセスの強制終了等ではOSの一時ディレクトリに残る可能性があるため、その場合は要確認。

設定はfixtureを開く前に実際のchrome.storage.localへ投入する。
現行実装が対応する文字列booleanを使用し、content.jsが設定を読み、
booleanへ正規化して保存したことを待つ。この保存はsettingsLoaded設定後に行われるため、
固定sleepなしで準備完了を検出できる。拡張初期化属性も確認する。
各テストは新規profileで、設定・Cookie・ページ状態を共有しない。

## 最小DOM契約

実サイトのHTMLや個人データをコピーせず、判定に必要な構造だけを記述する。
composerは実装に合わせたDIVのcontenteditable + ProseMirror + role=textbox +
data-composer-markdownで、送信ボタンはform内のbutton[type=submit]。

| fixture | 意図・期待 |
| --- | --- |
| old-composer.html | 旧data-chatgpt-composer付きform。Enter改行、Shift+Enterクリック1回 |
| current-composer.html | data-composer-placement=threadとdata-thread-find-composer=trueの現form。同上 |
| home-composer.html | 2026-10-08のWork実測に基づくhomeとdata-thread-find-composer=trueのform。旧属性なし。Enter改行、Shift+Enterクリック1回 |
| stale-composer.html | 0×0の残存editorと有効editor。有効な一候補を使って送信1回 |
| stale-only.html | 0×0 editorのみ。実際にfocusしてtrusted shortcutを押しても送信0回 |
| multiple-composers.html | 可視editor二つ。どちらをfocusしても曖昧として拡張から送信しない |
| no-submitter.html | ボタンなし。改行維持、shortcut送信0回 |
| multiple-submitters.html | ボタン二つ。改行維持、shortcut送信0回 |
| unknown-form.html | thread属性の片方が欠落。改行維持、shortcut送信0回 |

旧fixtureは旧「マーク付きform」の互換確認であり、
さらに古い#prompt-textarea専用のMeta+Enter経路のブラウザ再現ではない。
その経路は従来の単体テストが引き続き担当する。

page.jsはページ側の最小編集契約を実装する。
Shift+Enterを受けたらinsertLineBreakで編集し、素のEnterはページの既定送信を模す。
syntheticイベントにネイティブ編集のdefault actionがないため、ページ側ハンドラが必要になる。
拡張の設定・composer選択・可視性・submitter安全判定をここにコピーしない。
クリックはwindow.__submitCountで計測し、各送信shortcutで厳密に1を期待する。
synthetic Meta+Enterは意図的に無視し、古い送信経路ではPASSしない構造にする。
拡張無効のnegative controlで、素のEnterが送信、Shift+Enterが改行になることも確認する。

composer自体が曖昧・非表示なら、既存実装はイベントへ介入しない。
ここでいうfail closedは「拡張が送信操作を発火しない」ことで、
ホストページ自身のすべての送信を禁止する保証ではない。
候補が有効で送信UIだけが不確かな場合は、改行維持と送信0回を両方検証する。

## カバレッジと限界

19件: 正常旧/thread/home/stale混在4件、ctrl/both/combo3件、
no/multiple/unknown submitter/form3件、複数composer1件、staleのみ1件、
disabled/hidden/aria-disabled/opacity=0 submitter4件、
composition1件、不許可shortcut1件、拡張無効negative control1件。

Windows向けshift・ctrl・both・comboを実ブラウザで確認する。
Mac向けcmd・shiftCmd、プラットフォーム切替、keyCode 229、IME猶予80ms境界、
paste normalizationの厳密条件は既存単体テストが担当する。
ブラウザのcomposition試験は合成compositionstart/endとtrustedキーによる状態遷移確認で、
実OS IMEの候補確定を再現するものではない。
ページ自身もcomposition中のEnterを送信に使わない最小契約を持つ。

localhostではcontent.jsのpaste用URLガードを通らないため、
このブラウザテストは実サイトでのpaste/Undo/Redoを保証しない。
ProseMirror自体やReact、実ChatGPTの挙動・将来の未知DOMを完全再現するものでもない。
DOM変更を観測したら、個人データを含まない最小fixtureを追加して回帰を固定する。

JS例外・console error・想定外通信を検出して失敗させる。
固定sleep・リトライは使わず、状態・locator待ちで同期する。
screenshots/video/tracesは無効、生成結果とnode_modulesは.gitignoreで除外する。

## 回帰検出の確認

2026-10-05の実装時、過去commit
`e97e35819675766af1b1e867054f5d778d1e9df3`（1.3.2）のcontent.jsだけを
一時コピーへ入れて確認した。本番repoのコードは変更していない。

- 旧composer: PASS。
- 現composer: 改行の検証は通り、Shift+Enter後のクリック数が0（期待1）でFAIL。
- 現HEAD 1.3.3: 全18件PASS。

これにより、目的の「改行はできるが新DOMでshortcut送信できない」回帰を検出できる。

## Work home formの回帰と保守方針（2026-10-10）

2026-10-08のユーザー実測では、Workのformは旧マーカーがなく、
`data-composer-placement="home"` と `data-thread-find-composer="true"` を持つ。
composer検出とEnter改行は成立するが、従来のform判定はthreadだけを許可するため、
送信ショートカットでfail closedになる。

実装を変更する前に、次の追加テストを実行し、いずれも改行検証を通過した後、
送信回数が期待1・実際0で失敗することを確認した。

```sh
node --test --test-name-pattern="home-work: verified form button" tests/paste-cr-normalization.test.cjs
node node_modules/@playwright/test/cli.js test --grep home-composer
```

修正は既存のisRecognizedChatGPTComposerFormにhomeを追加するだけ。
旧属性、またはthread/homeと第二属性の厳密なANDを要求する。
単体テストはhomeでも全回帰を実行し、属性不足・false・空値・大文字・前後空白・
未知placement、composerの曖昧性と0×0候補、submitterの一意性・所属・表示・有効性、
フォーカス、IME、repeat、各送信設定、paste、クリック例外時の再送禁止を確認する。
aria-labelによる判定は追加しない。

コードとfixtureの調査では、placement依存は既存ヘルパー1か所に集約されている。
将来は第二属性と構造検査だけにできる可能性があるが、第二属性が他のformでも
使われるか、将来もcomposer専用であり続けるかは今回の観測からは分からない。
唯一の表示composerと有効submitterがあっても、未知formを正規と認定する根拠には
足りないため、今回はplacementを削除したり未知値を許可したりしない。
依存を減らす判断には、通常チャット・Work・送信対象外formでの追加実測と、
安定した識別根拠に基づく正負のfixtureが必要。

2026-10-10の再実測でも修正前の送信不能が継続していたことをユーザーが確認した。
その後、修正を適用した実ChatGPT Web版で、Workのhome入力欄のEnter改行・
設定ショートカットによる送信、および通常チャットの動作が正常になったと
ユーザーから報告された。修正前に送信不能だった環境での復旧確認を受け、
manifest versionを1.3.4に更新する。
ローカルChromiumのfixture試験は、実アプリの送信ハンドラやOS IMEを保証しない。
以下は手動回帰確認の手順であり、上記以外の項目をすべて確認済みとするものではない。

1. Chromeの拡張管理でこのフォルダの拡張を再読み込みし、対象ChatGPTタブも再読み込みする。
2. Workのhomeで、初期化マーカー、唯一の表示composer、フォーカス、formの両属性、
   同じformに属する唯一の表示・有効submitterを確認する。
3. テスト用会話に短い文を入力し、Enterで改行・未送信、設定したショートカットで
   1回だけ送信されることを確認する。初回送信後のthreadと通常チャットでも繰り返す。
4. Shift/Controlなど実環境で選べる送信設定を切り替え、設定した組合せだけが送信するか確認する。
5. 日本語IME変換確定で送信されないこと、キー長押しで重複送信されないこと、
   空入力・送信無効時に送信されないことを確認する。
6. CRLFの複数行貼り付けとUndo/Redoを確認する。UI言語を変えられる場合は送信も再確認する。

## Oopsとの将来連携

Oopsは今回変更しない。将来はextensions.jsonに例えば次を追加し、
アプリrepoをcwdにしてコマンドの終了コードを検査する構成が考えられる。

```json
{ "browserTestCommand": "npm run test:browser" }
```

これは提案であり、現在のOops configへそのまま追加済み・対応済みという意味ではない。
依存とブラウザの導入はCIの事前準備とし、検査コマンド中にインストールしない。
Gemini等へはrunnerの方式を再利用できるが、fixtureと期待値は各アプリのDOM契約に合わせる。
