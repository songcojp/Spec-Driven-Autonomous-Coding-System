# PRD: Spec-Driven Autonomous Coding System

バージョン: V2.0
ステータス: 公式ドラフト
製品名: SpecDrive AutoBuild
製品の方向性: Spec + CLI Skill + CLI Subagent 主導の長時間自律型プログラミングシステム

---

## 1. 製品定義

SpecDrive AutoBuild は、ソフトウェアチーム向けの長時間稼働する自律型プログラミングシステムです。システムは、構造化された「Spec」で製品の目標と受け入れ基準を管理し、プロジェクトローカルのCLI Skillで再利用可能なエンジニアリング手法を固定化し、Codex CLIネイティブのSubagentで委任とコンテキスト受け渡しを処理します。また、「Project Memory」を通じてCLIにセッションをまたぐ永続的な記憶を提供し、「Codex Runner」でコードの変更、テスト、修正を実行し、内部タスク状態マシンでタスクの進行、承認、リカバリ、および提供を管理し、「Dashboard」はその状態を表示します。

製品の核心となる結論:

```text
Spec Protocol
+ CLI Skill Directory
+ CLI Subagent Delegation
+ Project Memory
+ Codex Runner
+ Internal Task State Machine
+ Dashboard View
```

一言でのポジショニング:

> AIが、制御可能で、リカバリ可能かつ監査可能なエンジニアリングワークフローの中でコードを継続的に提供できるようにする。

---

## 2. 製品目標

### 2.1 コア目標

1. ユーザーが自然言語の要件を入力した後、システムが構造化されたFeature Specを生成する。
2. 優先度と準備状態に基づき、システムが次に実行するFeature Specを自動的に選択する。
3. システムがFeature Specのパイプライン（技術計画 → タスクグラフ → かんばん → スケジューリング）を自動的に推進する。
4. Specに基づいて技術計画、タスクグラフ、受け入れ基準、リスクルールをシステムが自動生成する。
5. 大規模なタスクをスケジュール可能なタスクに分割し、CLIネイティブのSubagentに委任できるようにする。
6. CLIのコンテキスト分割を再実装せず、永続的なRun、Evidence、Status、Review、Recovery状態を記録する。
7. Codex Runnerがコードの修正、テスト、修正、PRの生成を実行する。
8. Status Checkerがタスクの完了、失敗、ブロック、または承認の必要性を自動的に判断する。
9. Dashboardが、内部タスク状態マシンで管理されるタスクのステータスと配信の進捗をリアルタイムで表示する。
10. Project Memoryを各CLIセッションのプロジェクトレベルの記憶として提供し、目標、決定、ブロック状態の復元をサポートする。
11. 長時間の実行、失敗時の再試行、ブレークポイントからの復元、配信監査をサポートする。

### 2.2 対象外 (Non-Goals)

MVP（Minimum Viable Product）には以下を含まない:
* 独自の大規模言語モデル（LLM）の開発。
* 完全なIDEの自社開発。
* 企業向けの複雑な権限マトリックス。
* 本番環境への自動デプロイ。
* 複数の大規模リポジトリにまたがる複雑なマイクロサービスの自動移行。
* Jira、GitHub Issues、Linearなどの完全な代替。

---

## 3. コアアーキテクチャ

（英語翻訳版のアーキテクチャ図と同様の構造。要件の取り込み、スケジューラ、メモリ、Subagent、Codex Runnerなどが連携してシステムを構成する）

---

## 4. コアコンセプト

### 4.1 Spec Protocol
システムの内部における要件、計画、受け入れ、実行エビデンスのためのプロトコル。唯一の信頼できる情報源（Single Source of Truth）として機能し、Product Brief、Feature Spec、明確化ログ、タスクグラフ、受け入れ基準などが含まれる。

### 4.2 Skill System
再利用可能なエンジニアリング能力は、プロジェクトローカルの `.agents/skills/*/SKILL.md` に置かれる。Codex CLIがSkillの発見と呼び出しを担い、SpecDriveはreadiness checkとConsole表示のためにメタデータだけを読む。

### 4.3 Subagent Runtime
Subagent委任はCLIネイティブである。SpecDriveはAgent Run ContractやContext Sliceを作成せず、CLI実行の周辺にあるrun event、Evidence、Status Check、Review、Recovery、Audit履歴を記録する。

### 4.4 Project Memory
CLIの長時間実行向けのプロジェクトレベルの永続的な記憶（`.autobuild/memory/project.md`）。現在の目標、決定事項、ブロック状態を保存し、CLIが毎回リポジトリを再探索することなく作業を再開できるようにする。

### 4.5 Evidence Pack
各Subagent Runの構造化された結果出力。ステータスの判定、承認、リカバリ、および配信レポートに使用される。

---

## 5. ユーザーワークフロー
フェーズ1: プロジェクトの初期化 -> フェーズ2: 要件の取り込み -> フェーズ3: 自律的な実行ループ。
承認や明確化が必要な場合（Review Needed）を除き、システムはタスクを自動的に推進し続ける。

---

## 6. 機能要件

### 6.1 プロジェクト管理
* **FR-001**: プロジェクトの作成。
* **FR-002**: Gitリポジトリへの接続。
* **FR-003**: プロジェクトのヘルスチェック。

### 6.2 Spec Protocol Engine
* **FR-010**: Feature Specの生成。
* **FR-011**: PR/EARS形式の要件分解。
* **FR-012**: Specのスライス（タスク関連部分の抽出）。
* **FR-013**: 明確化ログの記録。
* **FR-014**: 要件チェックリストの生成。
* **FR-015**: Specのバージョン管理。

### 6.3 Skill Center
* **FR-020**: `.agents/skills/*/SKILL.md` からのプロジェクトローカルSkill発見。
* **FR-021**: CLI Skillファイルを再利用可能なworkflowの信頼できる情報源とする。
* **FR-022**: Skill実行契約はCodex CLIとSkillファイルが所有し、SQL registryでは管理しない。
* **FR-023**: Skill変更はファイルレビューとgit履歴で管理する。

### 6.4 Subagent Runtime
* **FR-030**: Subagentのタイプ（Spec、Architecture、Coding、Test、Reviewなど）。
* **FR-031**: CLIネイティブSubagent委任とevent観測。
* **FR-032**: Subagentの並行処理戦略（並行書き込み時は独立したGit Worktreeが必須）。
* **FR-033**: Status CheckerとEvidenceによる永続的なタスク結果判定。

### 6.5 Project Memory
* **FR-044 - FR-048**: メモリの初期化、CLIへの注入、Run終了ごとの自動更新、サイズ制限（8000トークン）、および履歴管理。

### 6.6 Feature パイプラインと選択
* **FR-054**: Featureの状態遷移マシン。
* **FR-055**: 自動Featureセレクター（優先度と準備状態に基づく）。
* **FR-056**: 計画パイプラインの自動推進。
* **FR-057**: タスク状態の集約と完了判定。
* **FR-058**: 複数Featureの並行実行戦略。

### 6.7 タスクグラフとかんばん (Task Graph & Board)
* **FR-050**: タスクグラフの生成。
* **FR-051 - FR-053**: かんばんの列、状態の自動遷移、およびタスクカードの詳細表示。

### 6.8 スケジューラ (Scheduler)
* **FR-060 - FR-064**: プロジェクトレベルとFeatureレベルの2段階スケジューリング、Worktreeによる分離、および長時間の復元機能。

### 6.9 Codex Runner
* **FR-070 - FR-072**: `codex exec` による実行、サンドボックスモード、および承認ポリシーのセキュリティ設定。

### 6.10 状態検出 (Status Check)
* **FR-080 - FR-082**: 差分、ビルド、テスト、Specの一致（Spec Alignment Check）などの自動検証による状態判定。

### 6.11 自動リカバリ (Auto Recovery)
* **FR-090 - FR-092**: 失敗時の回復、再試行戦略、および無限ループの防止。

### 6.12 承認センター (Review Center)
* **FR-100 - FR-101**: 高リスク、テスト失敗、大きな差分時の承認プロンプト。承認、拒否、修正要求、ロールバックをサポート。

### 6.13 PR と配信
* **FR-110 - FR-112**: 自動PR生成、配信レポート、および現実世界の制約に基づくSpec Evolution（Specの進化）。

---

## 7. コアデータモデル
Project、Feature、Requirement、Task、Run、ProjectMemory、EvidencePack、Runner、StatusCheck、Review、Recovery、Auditのモデルが含まれる。Skill Registryと独自Context Brokerのテーブルは含まれない。

---

## 8. ページ要件
Dashboard、Spec Workspace、Skill Center、Subagent Console、Dashboard Board、Runner Console、および Review Center のUI要件。Skill CenterはプロジェクトローカルSkillファイルを読み、Subagent Consoleは永続化されたrun、event、evidence、status-checkを表示する。

---

## 9. 非機能要件
* **セキュリティ**: 危険な操作の禁止、アクセス制限、ロールバック機能。
* **安定性**: 冪等性（べきとうせい）のあるRun、クラッシュからの復元。
* **可観測性**: 監査ログ、コストと成功率の追跡、一意のRun ID。
* **パフォーマンス**: かんばんの読み込みは2秒未満、Evidenceの書き込みは3秒未満。

---

## 10. 成功指標
Feature Specの生成・要件分解の成功率85%以上、低リスクタスクの自動完了率60%以上、PR生成およびタスク追跡の網羅率100%。

---

## 11. MVP バージョン計画
* **M1**: Spec Protocol + CLI Skill Discovery
* **M2**: 計画 + タスクグラフ + Feature セレクター
* **M3**: CLI Subagent Observation + Project Memory
* **M4**: Codex Runner
* **M5**: 状態検出とリカバリ
* **M6**: 承認と配信

---

## 12. 主要なリスクと対策
コンテキストの膨張、Project Memoryの陳腐化、並行Worktreeの競合、Agentの要件からの逸脱、および自動修復の無限ループを防ぐ対策が取られている。

---

## 13. 最終結論

SpecDrive AutoBuild V2.0 の原則:

> 「Specが方向のズレを防ぎ、Skillが能力を提供し、Subagentがコンテキストの膨張を防ぐ。Memoryが記憶喪失を防ぎ、Runnerが実際に実行し、かんばんが管理を可能にする。」
