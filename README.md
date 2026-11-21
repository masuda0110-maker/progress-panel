# progress-panel

Claude の作業の進捗と「次に自分がやること」を、会話の横のパネルに表示する Claude Code の Mod です。

## 表示する内容

- **次にやること**：Claude の最後の返答にある「👉」で始まる欄。なければ、Claude からの質問
- **全体の進捗**：この Mod が入っている全チャットの進み具合を、サイドバーのチャット名・色付きのバー・フォルダ名・今の作業・最終更新で一覧表示（直近1週間に動きがあったもの・最大10件）
  - 色：完了は緑、作業中は青、途中で止まっているもの（返事待ちなど）は黄、タスクなしは灰
- **このチャット**：タスクリストの完了数と各タスクの状態
- **ここまでの状況**：作業の区切りに Claude が書く要約

全体の進捗を出すため、各チャットは自分の進捗の要約（プロジェクトのフォルダ名・最初の依頼の冒頭・タスク数）を `~/.claude/progress-panel/sessions/` に書き出します。このフォルダはパソコンの中だけで使い、外部には送りません。チャット名は、デスクトップアプリが `~/Library/Application Support/Claude/claude-code-sessions/` に置くチャットの情報ファイルから読み取ります（読めないときは最初の依頼の冒頭を使います）。

タスクリストと要約は Claude デスクトップアプリの Code タブの機能から読み取ります。他の環境では、この2つは表示されません。

## インストール

ターミナルのセッションのプロンプトで：

```
/plugin install progress-panel --marketplace masuda0110-maker/progress-panel
```

シェルから：

```bash
claude plugin install progress-panel --marketplace masuda0110-maker/progress-panel
```

デスクトップアプリでは `/plugin` は使えません。プロンプト欄の横の + から Plugins を開き、Add marketplace に `masuda0110-maker/progress-panel` を入力してから、Add plugin を選びます。

## 使い方

デスクトップアプリではセッション開始時にパネルが自動で開きます。ターミナルや閉じたあとは `/progress-panel` で開けます。
