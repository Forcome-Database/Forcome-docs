# 图表使用指南

本文档介绍知识库支持的各种图表类型及其使用方法。

## 图表容器功能

所有图表都支持两种显示模式：

1. **普通模式** - 使用 ` ```mermaid ` 代码块，直接嵌入文档
2. **容器模式** - 使用 ` ```mermaid-box ` 代码块，带工具栏（缩放、全屏、复制）

### 容器模式示例

```mermaid-box{title="用户登录流程"}
flowchart LR
    A[访问网站] --> B[点击登录]
    B --> C{已有账号?}
    C -->|是| D[输入密码]
    C -->|否| E[注册账号]
    D --> F[登录成功]
    E --> F
```

---

## 思维导图 (Markmap)

适用于知识结构、概念梳理、学习路径等场景。

```markmap
# 知识库功能
## 企业应用
### 金蝶 ERP
### CRM 系统
### OA 办公
## AI 应用
### 智能财务
### 智能 PPT
## 知识学习
### 大模型基础
### Prompt 工程
```

**语法说明：**
- 使用 Markdown 标题层级表示节点关系
- `#` 为根节点，`##` 为一级分支，以此类推

---

## 流程图 (Flowchart)

适用于业务流程、决策逻辑、操作步骤等场景。

```mermaid
flowchart TD
    A[开始] --> B{条件判断}
    B -->|是| C[执行操作A]
    B -->|否| D[执行操作B]
    C --> E[记录日志]
    D --> E
    E --> F[结束]
```

**语法说明：**
- `TD` 表示从上到下，`LR` 表示从左到右
- `[]` 矩形，`{}` 菱形，`()` 圆角矩形，`(())` 圆形
- `-->` 实线箭头，`-.->` 虚线箭头

---

## 时序图 (Sequence Diagram)

适用于 API 调用、系统交互、消息传递等场景。

```mermaid
sequenceDiagram
    participant U as 用户
    participant F as 前端
    participant B as 后端
    participant D as 数据库
    
    U->>F: 1. 点击登录
    F->>B: 2. POST /api/login
    B->>D: 3. 查询用户
    D-->>B: 4. 返回用户数据
    B-->>F: 5. 返回 Token
    F-->>U: 6. 跳转首页
```

**语法说明：**
- `participant` 定义参与者
- `->>` 实线箭头，`-->>` 虚线箭头
- `Note over A,B: 文字` 添加注释

---

## 状态图 (State Diagram)

适用于状态机、工作流状态、订单状态等场景。

```mermaid
stateDiagram-v2
    [*] --> 草稿
    草稿 --> 待审核: 提交
    待审核 --> 已通过: 审核通过
    待审核 --> 已拒绝: 审核拒绝
    已拒绝 --> 草稿: 重新编辑
    已通过 --> 已发布: 发布
    已发布 --> [*]
```

**语法说明：**
- `[*]` 表示开始/结束状态
- `状态A --> 状态B: 事件` 定义状态转换

---

## ER 图 (Entity Relationship)

适用于数据库设计、实体关系建模等场景。

```mermaid
erDiagram
    CUSTOMER ||--o{ ORDER : "下单"
    ORDER ||--|{ ORDER_ITEM : "包含"
    PRODUCT ||--o{ ORDER_ITEM : "被购买"
    
    CUSTOMER {
        int id PK
        string name
        string email
    }
    ORDER {
        int id PK
        int customer_id FK
        date order_date
    }
    PRODUCT {
        int id PK
        string name
        decimal price
    }
```

**语法说明：**
- `||--o{` 一对多关系
- `||--|{` 一对多（必须）
- `PK` 主键，`FK` 外键

---

## 甘特图 (Gantt)

适用于项目计划、时间线、里程碑等场景。

```mermaid
gantt
    title 项目开发计划
    dateFormat YYYY-MM-DD
    
    section 需求阶段
    需求调研      :a1, 2024-01-01, 5d
    需求评审      :a2, after a1, 2d
    
    section 设计阶段
    架构设计      :b1, after a2, 5d
    UI 设计       :b2, after a2, 7d
    
    section 开发阶段
    前端开发      :c1, after b2, 15d
    后端开发      :c2, after b1, 20d
    
    section 测试阶段
    集成测试      :d1, after c1, 5d
    上线部署      :milestone, after d1, 0d
```

**语法说明：**
- `section` 分组
- `after a1` 表示在任务 a1 之后
- `milestone` 里程碑

---

## 饼图 (Pie)

适用于数据占比、分布统计等场景。

```mermaid
pie showData
    title 2024年销售额占比
    "华东区" : 35
    "华南区" : 28
    "华北区" : 22
    "西部区" : 15
```

**语法说明：**
- `showData` 显示数值
- `"标签" : 数值` 定义数据

---

## 用户旅程图 (User Journey)

适用于用户体验分析、流程优化等场景。

```mermaid
journey
    title 用户购物体验
    section 发现商品
      浏览首页: 5: 用户
      搜索商品: 4: 用户
      查看详情: 5: 用户
    section 下单购买
      加入购物车: 5: 用户
      填写地址: 3: 用户
      支付订单: 4: 用户
    section 收货评价
      等待发货: 3: 用户
      确认收货: 5: 用户
      发表评价: 4: 用户
```

**语法说明：**
- `section` 阶段分组
- `任务: 满意度(1-5): 角色`

---

## 类图 (Class Diagram)

适用于代码架构、对象关系、设计模式等场景。

```mermaid
classDiagram
    class Animal {
        +String name
        +int age
        +eat() void
        +sleep() void
    }
    
    class Dog {
        +String breed
        +bark() void
    }
    
    class Cat {
        +String color
        +meow() void
    }
    
    Animal <|-- Dog
    Animal <|-- Cat
```

**语法说明：**
- `+` 公有，`-` 私有，`#` 保护
- `<|--` 继承，`*--` 组合，`o--` 聚合

---

## Git 分支图 (Gitgraph)

适用于 Git 分支策略、版本管理等场景。

```mermaid
gitGraph
    commit id: "初始化项目"
    branch develop
    checkout develop
    commit id: "添加基础功能"
    commit id: "修复 Bug"
    branch feature/login
    checkout feature/login
    commit id: "实现登录页面"
    commit id: "添加表单验证"
    checkout develop
    merge feature/login
    checkout main
    merge develop tag: "v1.0.0"
    commit id: "热修复"
```

**语法说明：**
- `branch` 创建分支
- `checkout` 切换分支
- `merge` 合并分支
- `tag` 添加标签

---

## 快速参考

| 图表类型 | 代码块标识 | 容器模式 | 适用场景 |
|---------|-----------|---------|---------|
| 思维导图 | `markmap` | ✅ 自带容器 | 知识结构、概念梳理 |
| 流程图 | `mermaid` | `mermaid-box` | 业务流程、决策逻辑 |
| 时序图 | `mermaid` | `mermaid-box` | API 调用、系统交互 |
| 状态图 | `mermaid` | `mermaid-box` | 状态机、工作流 |
| ER 图 | `mermaid` | `mermaid-box` | 数据库设计 |
| 甘特图 | `mermaid` | `mermaid-box` | 项目计划、时间线 |
| 饼图 | `mermaid` | `mermaid-box` | 数据占比 |
| 用户旅程 | `mermaid` | `mermaid-box` | 用户体验分析 |
| 类图 | `mermaid` | `mermaid-box` | 代码架构 |
| Git 图 | `mermaid` | `mermaid-box` | 分支策略 |

## 容器模式使用说明

使用 `mermaid-box` 代替 `mermaid` 即可启用容器模式，支持：

- 🔍 **缩放** - 放大/缩小/重置
- 📋 **复制** - 一键复制图表代码
- 🖥️ **全屏** - 全屏查看，ESC 退出

可选添加标题：` ```mermaid-box{title="图表标题"} `
