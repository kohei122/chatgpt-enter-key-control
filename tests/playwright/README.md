# Playwright Mock DOM tests

## 実行

Node.js 20以上。単体テストはNode標準 `node:test` と `vm` による200件です。
旧ID・旧フォーム・通常thread・Work thread/homeを検証し、フォーム別のサイドチャット回帰を追加しています。
以前はpackage.jsonがなく、直接Nodeで実行していました。

```sh
npm ci
npx playwright install chromium
npm test
npm run test:browser
npm run test:all
```

- `npm test` / `npm run test:unit`: 従来の単体テストのみ。
- `npm run test:browser`: composer回帰31件とpopup回帰7件、計38件。
- `npm run test:all`: 単体、ブラウザの順に実行。失敗は非0で終了。
- インストール時のみnpm/CDN接続が必要。テスト実行はローカルfixtureのみ（貼り付けはオフラインHTTPS originを使用）。
- Linux CIでは `npx playwright install --with-deps chromium` を使用できる。
  headlessのためXvfb不要。今回の実測環境はWindows、Node 22.16.0、
  Playwright 1.63.0、付属Chromium 153.0.8010.12。Linux実機は未検証。

## 拡張のロードと設定

[Playwright公式の拡張テスト方式](https://playwright.dev/docs/chrome-extensions)に従い、
付属Chromiumの `channel: 'chromium'`、persistent context、
`--disable-extensions-except`、`--load-extension` を使う。

各テスト専用の一時ディレクトリに、実際のcontent.js、popup.js/html、
アイコン、ロケールをそのままコピーする。本番manifestは読み取りのみ。
一時manifestに限りcontent_scripts.matchesをlocalhostとオフライン貼り付けfixture用の
`https://chatgpt.com/__enter-key-control-tests__/*` に置換し、
設定投入用の小さなservice workerを追加する。本番拡張にはservice workerはない。
このworkerは拡張IDとchrome.storage.localへのアクセス用で、DOM・キー・送信ロジックを持たない。
content scriptの直接evalや代替実装は使用しない。
popupを開いたりactiveTabによる注入を行ったりせず、manifest経由で自動注入させる。

localhost HTTP serverはランダムポートを使う。貼り付け試験だけは本番のURLガードを通すため、
上記HTTPSパスを使用する。PlaywrightがHTML・JS・CSSをローカルfixtureから直接fulfillし、
外部へcontinue/fetchしない。外部DNS解決も遮断し、新規プロファイルのCookieは空である。
貼り付け試験ではテスト用Chromiumにclipboard権限を付与し、固定の試験文字列を貼り付ける。
これは試験用設定であり、本番manifestの権限を追加するものではない。
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
| multiple-composers.html | 認識済みの別formに可視editor二つ。focusしたeditorのformだけを操作。primary-form/side-formで送信先も検証 |
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

同じform内のcomposerが曖昧・対象が非表示・focus不一致なら、拡張はイベントへ介入しない。
別々の認識済みformに有効composerが一つずつあれば、それぞれ操作できる。
未認識formやformなしの旧ID経路は、従来のdocument全体の一意性を維持する。
ここでいうfail closedは「拡張が送信操作を発火しない」ことで、
ホストページ自身のすべての送信を禁止する保証ではない。
候補が有効で送信UIだけが不確かな場合は、改行維持と送信0回を両方検証する。

## カバレッジと限界

従来の19件: 正常旧/thread/home/stale混在4件、ctrl/both/combo3件、
no/multiple/unknown submitter/form3件、複数formの操作1件、staleのみ1件、
disabled/hidden/aria-disabled/opacity=0 submitter4件、
composition1件、不許可shortcut1件、拡張無効negative control1件。
追加12件: サイド単独、開閉・再追加・DOM交換、同一form内の曖昧性、他formへの代替送信禁止6条件、
無関係editor、入力欄別IME、trusted CRLF貼り付けと各入力欄の1回のUndo/Redo。

popup.spec.cjsは7言語ごとに実際の拡張popup.htmlを220px幅のタブで開く。
詳細ラベルと矢印、初期折りたたみ・展開・再読み込み時の状態、言語切替と保持、
manifest由来のversion、フッターの同一行・右寄せ・重なりや切れのない表示、
ON/OFFと送信設定の保存・再読み込み、設定後のhome改行・送信を確認する。
リンク先はchrome.tabs.createの呼び出しを観測し、外部ストアへは移動しない。
実Chromeツールバーのpopupウィンドウそのものの自動化ではない。

Windows向けshift・ctrl・both・comboを実ブラウザで確認する。
Mac向けcmd・shiftCmd、プラットフォーム切替、keyCode 229、IME猶予80ms境界、
paste normalizationの厳密条件は既存単体テストが担当する。
ブラウザのcomposition試験は合成compositionstart/endとtrustedキーによる状態遷移確認で、
実OS IMEの候補確定を再現するものではない。
ページ自身もcomposition中のEnterを送信に使わない最小契約を持つ。

localhostではcontent.jsのpaste用URLガードを通らない。追加のHTTPSオフラインfixtureでは
manifest経由で本番content.jsを注入し、trusted pasteのCRLF検出・キャンセル・段落構造・
CR除去とUndo/Redoを検証する。実サイトでのpaste/Undo/Redoを保証するものではない。
ProseMirror自体やReact、実ChatGPTの挙動・将来の未知DOMを完全再現するものでもない。
DOM変更を観測したら、個人データを含まない最小fixtureを追加して回帰を固定する。

JS例外・console error・想定外通信を検出して失敗させる。
固定sleep・リトライは使わず、状態・locator待ちで同期する。
自動screenshots/video/tracesは無効。popup試験のみ各言語の表示画像を明示的に
test-resultsへ保存する。生成結果とnode_modulesは.gitignoreで除外する。

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

## Oopsとの責任分界（v1.3.6確定時の確認）

隣接OopsのREADME、docs/release-delivery.md、docs/release-workflow.md、config/extensions.jsonを読み取り確認した。
ChatGPTにはManifest・Chrome公開baseline 1.3.2との権限比較・Unit/Browser共通Runner・既存ZIP検査が登録済み。
正式なローカルゲートはOops directoryで次を実行する。外部CI・Store操作・認証取得は行わない。

```sh
python -B -m oops check chatgpt-enter-key-control --tests all --require-tests --require-baseline --strict
```

ZIP未指定のPACKAGE_NOT_CHECKED INFOはZIP検査済みを意味しない。ZIP生成後に同じcheckへ
`--zip <absolute-path>`を指定し、manifest・権限・Package Validationを別途通す。
ChatGPTのpackage.recipeは未登録、統合release-workflowはClaude限定のため、今回その生成・公開機能は使用しない。
Oopsのソース・設定・baseline・stateは変更せず、ChatGPTの既存1.3.5 ZIPの14ファイル集合を
明示allowlistとして、push済み確定commitのGit blobから1.3.6 ZIPを生成する。
ZIPはrepo外に新規作成し、同名ファイルを上書きしない。全メンバーのcommit bytes一致、CRC、7言語、
manifest参照資産、親folder・開発ファイル不在、SHA256を検証する。

<a id="v136-release-validation"></a>

## v1.3.6 サイドチャット対応・リリース検証記録（2026-10-26）

ユーザー確認DOMはDIV.ProseMirror、role=textbox、contenteditable=true、
data-composer-markdownあり。form自身にdata-composer-placement=threadとdata-thread-find-composer=true、
親form所属の表示・有効なsubmit buttonが1個あり、既存の厳密なフィルターを満たす。
診断用ProseMirror数だけで候補数を判断せず、追加試験では既存セレクターと有効性・表示条件を満たす2候補を構成する。

イベント対象を含む可視・有効候補を一意に選び、document focusとactiveElementの包含を要求する。
認識済みformではform内候補が1個であることを要求し、送信時は取得時のform同一性も再確認する。
認識済みformでは旧IDがあっても所属formのボタンを使う。旧ID・未認識formの従来経路は
全体が一候補のときだけ維持し、未知formの送信を新たに許可しない。
同一form内の複数候補、入れ子候補、送信UIの曖昧性は非介入／送信なしを維持する。

IME状態はWeakMapで入力欄別に保持し、compositionendはfocus移動後も元の入力欄へ記録する。
変換中のfocusoutはその入力欄の状態を終了して80ms保護を残す。
貼り付けは独立したIME条件、厳密な空欄・MIME・選択範囲・文字列制限を維持し、
挿入後は元入力欄と元form、focus、段落内容、末尾選択を再検証する。
別formの追加・削除だけでは失敗としない。同一formの曖昧化、移動、交換、検証失敗は再試行せず安全側で停止する。

開発時HEAD（69c7e2e）の旧content.jsをファイルへ書かずメモリ上で追加回帰に読み込ませ、
旧form/thread-chat/thread-work/home-workの4構成すべてでEnter非介入による失敗を確認した。
これは意図した回帰検出であり、修正後の全テスト結果とは区別する。

manifestを1.3.5から1.3.6へ更新。独立した開発package version方針は記録されておらず、
過去のmanifest更新時に残っていたpackage.json/package-lock.jsonの1.3.3も1.3.6へ同期する。
確定作業では機能コード・安全条件を追加変更せず、versionとリリース記録を更新する。
本番permissionsはstorage/activeTab/scriptingのまま。host_permissions追加なし、content_scripts範囲変更なし、
外部通信・テレメトリー・会話内容収集の追加なし。

ユーザーが実ChatGPT環境で以下の全9項目PASSを確認したと報告した。
これはユーザーによる実ブラウザ確認であり、Codex自身が実施したものではない。

1. 通常チャットのEnter改行・ショートカット送信：PASS
2. サイドチャットのEnter改行・ショートカット送信：PASS
3. 送信先の正確性・重複送信なし：PASS
4. 通常チャットとサイドチャットのフォーカス切替：PASS
5. サイドチャットの閉じる・再表示：PASS
6. 日本語IME変換・確定：PASS
7. 送信ショートカット長押し：PASS
8. CRLF複数行貼り付け・Undo/Redo：PASS
9. ChatGPT Work home/threadの既存動作：PASS

確定版の自動検証結果（2026-10-26）：

- `npm run test:all`：Unit 200件成功・失敗0・skip 0、Playwright 38件成功・失敗0・skip 0（composer 31件、popup 7言語）。
- Oops `check --tests all --require-tests --require-baseline --strict`：終了0、Unit/BrowserともPASS。FAIL・未承認WARNINGなし。ZIP作成前のPACKAGE_NOT_CHECKED INFOは作成後の検査と区別する。
- 本番・変更テストJSの`node --check`、manifest/package/lockfileのversion一致、manifest差分がversionのみ、7言語と権限の監査、`git diff --check`：PASS。
- 開発候補の7ファイルを保護し、確定時の追加変更はREADME・manifest・package・lockfileと本記録のみ。機能コードの追加変更なし。

検証の限界：自動試験はfixtureとVM、実サイトの確認は上記ユーザー報告に限る。
全OS・全UI言語・全アカウントでの実サイト動作や将来のDOMは保証しない。Chrome/Edgeのストア提出・公開確認とLP更新は次工程。
キャンセル済み送信ショートカットから送信しないことを検証する。既存のキー伝播抑止は維持しており、
「キャンセル済みイベントへの非介入」を一切のイベント操作なしと解釈する場合とは異なる。今回は機能変更しない。
