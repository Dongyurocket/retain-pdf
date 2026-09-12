# RetainPDF 航空·航天·力学领域英汉术语表规范与说明

本目录收录专门为 RetainPDF 项目定制的航空、航天与力学领域双语术语库。词库严格按照 RetainPDF 术语表导入格式标准构建，并通过了工程级合规性校验。

---

## 1. 文件清单与架构设计

根据 RetainPDF 后端 Rust API（`backend/rust_api/src/services/glossaries.rs`）中 `const MAX_GLOSSARY_ENTRIES: usize = 200;` 的硬性约束，单一术语表资源最大容纳 200 条词条。为此，本目录提供了兼顾“直接导入”与“细分深耕”的模块化文件：

| 文件名 | 词条数 | 适用场景 | 说明 |
| :--- | :---: | :--- | :--- |
| **`aviation-200-zh-cn.csv`** | **200** | **航空专精满额表（单表上限）** | **全新 200 条满额航空专精表**。系统覆盖高速气动、飞行力学与操纵动态、航空发动机与推进装置、航空器机体结构与材料、现代综合航电与仪表、飞行性能速度基准、空中交通管制与运行规程，达到 RetainPDF 单表容量上限（200 条）。 |
| **`aerospace-mechanics-zh-cn.csv`** | **195** | **推荐：直接导入综合单表** | **精选旗舰表**。覆盖航空（65 条）、航天（65 条）、力学（65 条），无任何大小写重名冲突，严格控制在 200 条上限内，并预留 5 条增补空间。 |
| **`aviation-zh-cn.csv`** | **100** | 航空文献基础翻译 | 覆盖空气动力学、飞行力学、航空器结构、航空发动机、航电导航、性能与机场运行。 |
| **`spaceflight-zh-cn.csv`** | **100** | 航天工程与深空探测 | 覆盖轨道力学、运载火箭、航天器总体、制导导航控制 (GNC)、推进系统、空间环境与测控。 |
| **`mechanics-zh-cn.csv`** | **100** | 理论与工程力学专业 | 覆盖理论力学、分析力学、连续介质、材料/固体力学、流体力学、结构力学、断裂疲劳与计算力学。 |
| **`all-aerospace-mechanics-300-zh-cn.csv`** | **300** | 全量词典与参考库 | 上述三张分表的 300 条独立汇编大表，全量 300 个英文 source 互不重复。 |

---

## 2. 权威术语来源与核验依据

所有中英文术语均以国家与国际公认的学科名词审定标准为依据，核验基准日期为 **2026-09-12**：

### 2.1 国内权威审定标准
- **全国科学技术名词审定委员会（全国科技名词委）/ 术语在线 (`termonline.cn`)**：
  - 《航空科学技术名词》（第一版 / 第二版）：全国科学技术名词审定委员会审定公布，涵盖飞行原理、航空器结构、航空动力与仪表设备。
  - 《航天科学技术名词》：全国科学技术名词审定委员会审定公布，涵盖人造卫星、运载火箭、空间物理、航天器控制与测控通信。
  - 《力学名词》（力学名词审定委员会）：涵盖理论力学、分析力学、固体力学、流体力学与计算力学规范译名。

### 2.2 国际与专业组织规范
- **美国联邦航空管理局 (FAA)**：
  - *Pilot’s Handbook of Aeronautical Knowledge (FAA-H-8083-25C)*：官方飞行原理与航空运行术语集（Glossary 及各核心章节）。
  - 参考 URL：`https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/phak`
- **美国国家航空航天局 (NASA)**：
  - *NASA Thesaurus*：由 NASA 科学技术信息计划 (STI Program Office) 维护的受控词表（Controlled Vocabulary），覆盖航空航天工程及支撑工程物理学科。
  - 参考 URL：`https://sti.nasa.gov/nasa-thesaurus/`
- **国际理论与应用力学联盟 (IUTAM)**：
  - 国际力学组织通用学科分类与连续介质力学、流体力学经典术语规范。

---

## 3. CSV 字段规范与契约说明

数据文件采用标准 UTF-8 编码，包含 6 个标准列：

```csv
source,target,note,level,match_mode,context
```

### 字段详细说明

| 字段名 | 必填 | 长度限制 | 说明与取值范围 |
| :--- | :---: | :---: | :--- |
| **`source`** | 是 | ≤ 200 字符 | 英文原词。统一使用规范英文短语或通用缩写，去除首尾空白。 |
| **`target`** | 是 | ≤ 200 字符 | 简体中文规范译名。当 `level=preserve` 且该字段留空时，系统自动回填 source。 |
| **`note`** | 否 | ≤ 500 字符 | 简要说明。标注学科背景、同义词辨析或消歧提示。 |
| **`level`** | 否 | 枚举 | 术语干预强度：<br>• `canonical`：规范/强制翻译（本词表主要采用）<br>• `preferred`：优先推荐翻译<br>• `preserve`：保留原文不翻译 |
| **`match_mode`** | 否 | 枚举 | 匹配模式：<br>• `case_insensitive`：大小写不敏感（常规专业词汇）<br>• `exact`：严格精确匹配（缩写如 `VOR`、`ILS`、人名法则如 `Mach number`、`Young's modulus`）<br>• `regex`：正则表达式匹配 |
| **`context`** | 否 | ≤ 200 字符 | 细分学科路径。采用层次化标示，如 `航空·空气动力学`、`航天·轨道力学`、`力学·流体力学`。 |

---

## 4. 关键术语消歧与跨学科决策

在航空、航天与力学三个交叉学科中，部分词汇在不同语境下具有细微但关键的翻译差异，本词表作了如下统一与消歧决策：

1. **`angle of attack`**：
   - 航空与流体力学中审定规范首选用词为 **“迎角”**（又称“攻角”），本表统一采用规范译名“迎角”，并在 note 中说明“航空语境规范译名”。
2. **`weight` 与 `gravity`**：
   - 在飞行力学经典的“四力平衡模型”（Lift, Drag, Thrust, Weight）中，`weight` 严格翻译为 **“重量”**，以保持与飞行原理教科书和民航运行规程一致；物理学基本作用力则对应 `gravitational force / 重力`。
3. **`Mach number`、`boundary layer`、`laminar flow`、`turbulent flow`**：
   - 流体力学与航空空气动力学的共有基石。规范统一译为 **“马赫数”**、**“边界层”**、**“层流”**、**“湍流”**。专有无量纲数 `Mach number` 设为 `exact` 精确匹配以保留大写 `M`。
4. **`pitch` / `roll` / `yaw`**：
   - 飞行姿态控制经典三轴运动，规范译为 **“俯仰”**、**“滚转”**（或横滚）、**“偏航”**。在机械传动语境下 `pitch` 需注意与“齿距/螺距”区分，本词表在 context 中明确限定为 `航空·飞行力学`。
5. **结构构件名词 `beam` / `plate` / `shell` / `truss`**：
   - 结构力学典型承力体系，分别对应 **“梁”**、**“板”**、**“壳”**、**“桁架”**。
6. **缩写与专有名词大小写保护**：
   - 航空导航：`VOR`（甚高频全向信标）、`DME`（测距设备）、`ILS`（仪表着陆系统）、`GPS`、`GNSS` 均设为 `exact`。
   - 人名力学方程与常数：`Young's modulus`（杨氏模量）、`Poisson's ratio`（泊松比）、`Navier-Stokes equations`（纳维-斯托克斯方程）、`Hohmann transfer`（霍曼转移）、`J-integral`（J积分）均设为 `exact`。

---

## 5. 格式校验与导入指引

### 5.1 本地自动校验脚本
项目内置了符合 Rust API 校验逻辑的独立脚本：

```bash
# 校验 200 条满额航空专精表
python backend/scripts/devtools/validate_glossary_csv.py resources/glossaries/aviation-200-zh-cn.csv

# 校验推荐的 195 条三合一综合单表文件（严格 <= 200 条限制）
python backend/scripts/devtools/validate_glossary_csv.py resources/glossaries/aerospace-mechanics-zh-cn.csv

# 校验各个 100 条分领域表
python backend/scripts/devtools/validate_glossary_csv.py \
  resources/glossaries/aviation-zh-cn.csv \
  resources/glossaries/spaceflight-zh-cn.csv \
  resources/glossaries/mechanics-zh-cn.csv

# 校验 300 条全量汇编大表（使用 --allow-large 豁免单表 200 条限制）
python backend/scripts/devtools/validate_glossary_csv.py resources/glossaries/all-aerospace-mechanics-300-zh-cn.csv --allow-large
```

### 5.2 在 RetainPDF 中导入使用
1. **Web 前端界面**：
   - 进入 RetainPDF -> 打开 **设置 (Settings)** -> 导航至 **术语表 (Glossaries)** 面板。
   - 点击 **导入 CSV (Import CSV)**，选择 `resources/glossaries/aerospace-mechanics-zh-cn.csv`。
   - 导入后系统自动识别字段，点击保存即可生成名为例如 `aerospace-mechanics` 的常驻术语表资源。
2. **任务创建时关联**：
   - 提交翻译任务时，在任务配置中选择该术语表 ID（`glossary_id`），或设置 `glossary_mode=canonical`（规范强制）。
3. **REST API 导入**：
   ```http
   POST /api/v1/glossaries/import
   Content-Type: multipart/form-data
   
   file: @resources/glossaries/aerospace-mechanics-zh-cn.csv
   name: 航空航天力学术语表
   ```
