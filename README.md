# progress-panel

Claude の作業の進捗と「次に自分がやること」を、会話の横のパネルに表示する Claude Code の Mod です。

## 表示する内容

- **次にやること**：Claude の最後の返答にある「👉」で始まる欄。なければ、Claude からの質問
- **進捗**：タスクリストの完了数と各タスクの状態
- **ここまでの状況**：作業の区切りに Claude が書く要約

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
