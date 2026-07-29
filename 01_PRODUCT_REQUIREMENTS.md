# Bullion Ledger — Product Requirements Document

- **文件名稱**：01_PRODUCT_REQUIREMENTS.md
- **系統名稱**：Bullion Ledger
- **文件版本**：v0.1
- **文件狀態**：初版需求定義
- **系統類型**：單一使用者、自主託管的實體貴金屬資產管理 Web 應用程式
- **主要部署方式**：Docker Compose
- **主要使用介面**：桌面瀏覽器與手機瀏覽器／PWA

---

## 1. 文件目的

本文件定義 Bullion Ledger 第一階段至完整版本的產品需求、核心計算規則、頁面功能、資料模型、系統架構、安全要求與驗收條件。

Bullion Ledger 用於記錄使用者購買及持有的實體貴金屬，包括黃金、白銀，以及未來可擴充的鉑金、鈀金等資產。系統不只是記錄購買成本，也必須追蹤貴金屬歷史行情、購入時的市場價格、商品溢價、目前內含價值、預估可變現價值，以及照片、證書、發票等證明資料。

---

## 2. 產品定位

Bullion Ledger 是一套針對實體貴金屬持有者設計的私人資產管理系統。

系統需要回答以下問題：

1. 我目前持有哪些實體貴金屬？
2. 每件商品是在什麼時間、向誰、以多少價格購買？
3. 每件商品的重量、純度與純金屬重量是多少？
4. 購買當下的國際現貨價格與匯率是多少？
5. 我在市場價格圖上的哪個位置買入？
6. 我購買時支付了多少實體商品溢價？
7. 目前依照現貨價格計算的內含價值是多少？
8. 目前實際出售時，預估可拿回多少錢？
9. 我累計投入多少、目前損益多少、報酬率多少？
10. 商品照片、序號、證書及發票存放在哪裡？

---

## 3. 系統範圍

### 3.1 第一階段支援金屬

- 黃金 Gold
- 白銀 Silver

### 3.2 預留擴充金屬

- 鉑金 Platinum
- 鈀金 Palladium
- 其他由管理頁面自行新增的金屬

### 3.3 商品形式

- 金條／銀條
- 金幣／銀幣
- 鑄幣
- 紀念幣
- 飾金
- 顆粒或原料
- 其他實體貴金屬商品

### 3.4 不在初期範圍內

- 多使用者或多人共享
- 多租戶 SaaS
- 股票、ETF、期貨及虛擬貴金屬帳戶
- 自動報稅或會計申報
- 自動交易
- 黃金價格預測
- 區塊鏈存證
- 未經授權的商家網站爬蟲

---

## 4. 使用者模型

### 4.1 單一使用者

Bullion Ledger 僅供一位使用者使用，因此不建置：

- 使用者列表
- 管理員與一般使用者角色
- 權限群組
- 邀請功能
- 組織或團隊管理

系統內只存在一個有效帳號。

### 4.2 初始帳號建立

首次啟動時，系統進入初始化流程：

1. 建立唯一使用者帳號。
2. 設定 username。
3. 設定 password。
4. 建議立即註冊 Passkey。
5. 完成後停用初始化入口。

初始帳號不得透過公開註冊頁面建立。

### 4.3 帳號設定

使用者可在「設定 > 帳號與安全性」中：

- 修改 username
- 修改 password
- 查看已註冊的 Passkey
- 新增 Passkey
- 重新命名 Passkey
- 刪除 Passkey
- 查看 Passkey 建立時間與最後使用時間
- 登出目前工作階段
- 登出所有其他工作階段

修改 password 前必須重新驗證目前密碼或使用現有 Passkey 驗證。

---

## 5. 登入與 Passkey

### 5.1 支援登入方式

Bullion Ledger 必須支援：

1. Username + Password
2. Passkey／WebAuthn

### 5.2 Touch ID 登入

在支援 WebAuthn 的 macOS 裝置與瀏覽器上，使用者可透過儲存在 Mac 或 iCloud Keychain 中的 Passkey，使用 Touch ID 完成登入。

系統不得直接存取 Touch ID 指紋資料。Touch ID 由作業系統及平台驗證器處理，Bullion Ledger 僅接收 WebAuthn 驗證結果。

### 5.3 Passkey 要求

- 使用標準 WebAuthn／FIDO2
- 支援 platform authenticator
- 支援 discoverable credentials
- 支援 user verification
- 預設要求 user verification 為 required
- 每組 Passkey 儲存 credential ID、public key、counter、transports、建立時間與最後使用時間
- 不儲存生物辨識資料
- 至少保留 username + password 作為復原登入方式

### 5.4 Session 管理

- 使用安全的 HttpOnly Cookie
- Cookie 必須設定 Secure 與 SameSite
- Session 需有絕對有效期限與閒置期限
- 支援手動登出
- 支援撤銷所有其他 Session
- 登入失敗需具備速率限制與暫時鎖定

---

## 6. 核心資料概念

### 6.1 Product Definition

代表一種商品型號，例如：

- 臺灣銀行一台兩金條
- PAMP Suisse 10 g Gold Bar
- Canadian Maple Leaf 1 oz Silver Coin

Product Definition 是商品規格，不代表實際持有的單一物件。

### 6.2 Asset

代表使用者實際持有的一件或一批可追蹤資產。

即使兩件商品型號相同，只要購買日期、成本、序號或證明文件不同，就必須建立不同 Asset。

### 6.3 Purchase

代表一次購買交易。一筆 Purchase 可包含多個 Purchase Item。

### 6.4 Asset Movement

記錄資產生命週期中的每一次異動，包括：

- 購買入庫
- 售出
- 部分售出
- 贈與
- 收到贈與
- 遺失
- 損壞
- 盤點調整
- 存放位置移轉
- 送鑑定
- 鑑定取回

### 6.5 Price Snapshot

代表某個時間點的金屬市場價格及匯率快照。

### 6.6 Valuation Snapshot

代表某個時間點，整體資產或單一 Asset 的估值結果。估值快照必須保存計算所使用的價格、匯率與估值規則，以避免未來規則變更後無法還原歷史結果。

---

## 7. 重量與單位

### 7.1 使用者可切換單位

所有主要資產頁面、Dashboard、圖表 Tooltip、商品詳情與報表，必須允許在下列單位間切換：

- 公克 g
- 公斤 kg
- 金衡盎司 oz t／troy oz
- 台錢 qian

介面顯示可簡寫為：

- g
- kg
- oz
- 台錢

但在說明文字及設定頁中，必須清楚標示系統使用的是「金衡盎司」，避免與一般盎司混淆。

### 7.2 內部標準單位

資料庫所有重量一律以公克儲存，不因顯示單位不同而改變原始資料。

```text
1 kg = 1000 g
1 troy oz = 31.1034768 g
1 台錢 = 3.75 g
```

### 7.3 單位切換範圍

使用者可設定：

- 全域預設重量單位
- 單一頁面的暫時顯示單位
- 新增商品時的輸入單位

切換顯示單位不得修改資料庫中的原始重量。

### 7.4 重量欄位

每個資產至少包含：

- 標示毛重
- 毛重單位
- 換算後毛重公克數
- 純度
- 純金屬重量公克數
- 可選的實測重量
- 實測日期

```text
純金屬重量 = 毛重 × 純度
```

純度應使用十進位比例儲存，例如：

- 999.9‰ 儲存為 0.9999
- 925‰ 儲存為 0.925
- 24K 可換算為對應純度，但原始標示可另行保留

---

## 8. 購買交易管理

### 8.1 購買基本資料

每筆購買交易包含：

- 購買日期
- 購買時間
- 購買商家
- 分店或通路
- 訂單編號
- 發票號碼
- 購買幣別
- 付款方式
- 金屬商品小計
- 商品溢價
- 工錢
- 稅費
- 運費
- 其他費用
- 折扣
- 最終付款總額
- 備註

### 8.2 購買商品資料

每個 Purchase Item 包含：

- 對應 Product Definition
- 金屬種類
- 商品形式
- 品牌
- 商品名稱
- 生產國家
- 年份或版本
- 序號
- 數量
- 單件重量
- 重量單位
- 純度
- 單件純金屬重量
- 單件分攤成本
- 包裝狀態
- 是否附證書
- 初始存放位置

### 8.3 成本分攤

當一筆交易包含多件商品時，系統必須支援：

- 使用者手動指定每件商品成本
- 依商品金額比例分攤共同費用
- 依重量比例分攤共同費用
- 平均分攤

系統必須保存使用的分攤方法與分攤結果。

---

## 9. 購入當下行情快照

儲存購買交易時，系統應自動取得並保存：

- 金屬代碼，例如 XAU、XAG
- 原始市場報價
- 報價幣別
- 報價單位
- 報價時間
- 行情來源
- USD/TWD 或所需幣別匯率
- 換算後每公克價格
- 換算後每台錢價格
- 購入當下的純金屬內含價值
- 購入時的溢價金額
- 購入時的溢價率
- API 原始回傳資料或可稽核摘要

若當下行情服務不可用：

1. 仍允許先儲存草稿或交易。
2. 顯示行情尚未補齊的狀態。
3. 背景工作持續重試。
4. 使用者可手動輸入行情。
5. 手動行情必須標示來源為 manual。

---

## 10. 價值與損益計算

### 10.1 購買總成本

```text
購買總成本
= 金屬商品價格
+ 商品溢價
+ 工錢
+ 稅費
+ 運費
+ 其他費用
- 折扣
```

### 10.2 當前內含價值

```text
當前內含價值
= 純金屬重量
× 當前每公克現貨價格
```

### 10.3 購入溢價

```text
購入溢價金額
= 購買總成本 - 購入當時內含價值

購入溢價率
= 購入溢價金額 ÷ 購入當時內含價值
```

### 10.4 現貨帳面損益

```text
現貨帳面損益
= 當前內含價值 - 購買總成本
```

### 10.5 預估可變現價值

```text
預估可變現價值
= 適用回購單價 × 純金屬重量
- 預估鑑定費
- 預估手續費
- 其他折價
```

### 10.6 真實未實現損益

```text
真實未實現損益
= 預估可變現價值 - 購買總成本
```

### 10.7 報酬率

```text
報酬率
= 損益 ÷ 購買總成本 × 100%
```

所有金額、重量、匯率與比例計算必須使用 Decimal，不得使用一般浮點數作為最終財務計算基礎。

---

## 11. Dashboard

Dashboard 分為「資產總覽」與「市場歷史與買點」兩個主要視角。

### 11.1 資產總覽 Dashboard

必須顯示：

- 累計購買總成本
- 當前現貨內含價值
- 預估可變現價值
- 現貨帳面損益
- 真實未實現損益
- 已實現損益
- 總報酬率
- 累計支付溢價
- 黃金持有重量
- 白銀持有重量
- 持有商品件數
- 尚未補齊行情的交易數量
- 尚未補齊照片或證書的資產數量

### 11.2 資產配置圖

支援依下列維度檢視：

- 金屬種類
- 商品形式
- 品牌
- 商家
- 購買年份
- 存放位置
- 持有重量
- 購買成本
- 當前內含價值
- 預估可變現價值

### 11.3 資產價值歷史圖

同一張時間序列圖至少顯示：

- 累計投入成本
- 現貨內含價值
- 預估可變現價值

支援時間範圍：

- 7 天
- 1 個月
- 3 個月
- 6 個月
- 1 年
- 今年至今
- 全部
- 自訂日期

### 11.4 市場歷史與買點 Dashboard

系統必須提供獨立頁面，用於查看各種貴金屬的歷史市場價格，以及使用者每次買入所在的價格位置。

此頁面至少包含：

#### 11.4.1 金屬選擇

- 黃金
- 白銀
- 未來新增的其他金屬

#### 11.4.2 價格圖表

- 折線圖或 K 線圖
- 可切換報價幣別
- 可切換每公克、每公斤、每金衡盎司、每台錢
- 可切換時間範圍
- 可縮放與拖曳
- 顯示 Tooltip
- 顯示資料來源與最後更新時間

#### 11.4.3 買點標記

每次購買必須在歷史價格圖上標記。

買點標記至少顯示：

- 購買日期與時間
- 商品名稱
- 購買數量
- 購買重量
- 購買總成本
- 購入當下現貨價格
- 實際每單位購入成本
- 購入溢價率
- 對應交易連結

當同一天或接近時間有多筆交易時，圖表應支援：

- 標記群組
- 展開查看多筆交易
- 避免標記互相重疊

#### 11.4.4 買入成本線

圖表可選擇顯示：

- 每筆買入價格
- 目前持倉加權平均成本線
- 純金屬加權平均現貨成本線
- 損益兩平線
- 商家回購價格線

#### 11.4.5 歷史交易列表

圖表下方同步顯示交易列表：

- 日期
- 商品
- 金屬
- 重量
- 購買價格
- 當時市場價格
- 溢價率
- 目前損益

點擊圖表買點時，列表自動定位到該交易；點擊列表交易時，圖表自動定位到該買點。

### 11.5 溢價分析

- 各商品購入溢價率
- 各商家平均溢價率
- 不同重量規格溢價率
- 黃金與白銀累計溢價
- 溢價占總成本比例
- 金屬價格需上漲多少才能回本

### 11.6 Dashboard 單位切換

Dashboard 頂部提供全域重量單位切換：

- g
- kg
- oz
- 台錢

切換後，所有相關卡片、圖表、Tooltip 與表格同步更新。

---

## 12. 市場行情管理

### 12.1 Price Provider 抽象層

後端不得將系統綁死在單一行情 API。必須建立統一 Price Provider 介面。

介面至少支援：

- 取得最新價格
- 取得指定時間點附近價格
- 取得歷史時間序列
- 取得支援金屬清單
- 取得資料來源狀態

### 12.2 行情類型

系統需區分：

- 國際現貨價 Spot Price
- 基準價 Benchmark Price
- 商家售價 Dealer Sell Price
- 商家回購價 Dealer Buyback Price
- 使用者手動輸入價格

不同類型不可混為同一欄位。

### 12.3 排程

預設排程：

- 每 5 分鐘取得最新行情
- 每小時建立市場價格快照
- 每日建立永久日結快照
- 新增購買交易時立即取得行情
- 行情取得失敗時進行背景重試

排程間隔可在設定頁調整。

### 12.4 歷史資料保存

為支援市場歷史圖與買點標記，系統必須保留歷史價格資料。

至少保存：

- timestamp
- metal
- price
- quote currency
- quote unit
- normalized price per gram
- provider
- source type
- retrieval time

系統需避免將相同來源、相同金屬、相同時間粒度的資料重複寫入。

---

## 13. 商家與實體溢價管理

### 13.1 商家資料

- 商家名稱
- 分店名稱
- 網址
- 聯絡方式
- 地址
- 備註
- 是否啟用

### 13.2 商家報價

- 商品或適用規則
- 商家售價
- 商家回購價
- 報價幣別
- 報價單位
- 報價時間
- 報價來源
- 報價網址
- 截圖或附件
- 包裝要求
- 是否限原購買人
- 是否限原購買商家
- 鑑定費
- 手續費
- 備註

### 13.3 回購估值規則

回購規則可依以下條件設定：

- 金屬
- 商品形式
- 品牌
- 商品型號
- 商家
- 重量區間
- 包裝狀態
- 證書狀態

估值方式至少支援：

- 固定每公克回購價
- 現貨價格乘以係數
- 現貨價格扣固定金額
- 商家最新回購價
- 手動估值

---

## 14. 照片、證書與附件

### 14.1 附件類型

- 商品正面
- 商品背面
- 商品側面
- 包裝
- 序號
- 防偽標誌
- 證書
- 發票
- 收據
- 訂單截圖
- 匯款證明
- 商家報價
- 鑑定文件
- 其他

### 14.2 附件需求

- 每個 Asset 可上傳多個附件
- 每筆 Purchase 可上傳多個附件
- 支援圖片與 PDF
- 支援手機直接拍照
- 支援附件描述與標籤
- 支援設定封面照片
- 支援查看原始檔
- 支援縮圖
- 支援刪除與軟刪除
- 檔案儲存在 MinIO
- PostgreSQL 僅保存 Metadata

### 14.3 隱私與安全

- MinIO Bucket 必須為 private
- 前端透過短效 signed URL 存取
- 不允許公開永久 URL
- 存放位置等敏感附件可標記為高敏感
- 高敏感附件開啟前可要求重新驗證

---

## 15. 資產與庫存管理

### 15.1 資產列表

支援：

- 搜尋
- 篩選
- 排序
- 分頁
- 卡片模式
- 表格模式
- 依金屬篩選
- 依商品形式篩選
- 依品牌篩選
- 依商家篩選
- 依存放位置篩選
- 依持有狀態篩選
- 依文件完整度篩選

### 15.2 資產詳情

顯示：

- 基本規格
- 購買資訊
- 重量與純度
- 當時行情
- 當前行情
- 購入溢價
- 當前估值
- 預估回購價值
- 損益
- 照片與附件
- 序號
- 存放位置
- 異動歷史
- 對應歷史價格圖與買點

### 15.3 部分售出

對可拆分資產或同批次多件商品，系統必須支援部分售出。

售出後必須正確計算：

- 剩餘數量
- 剩餘重量
- 分攤成本
- 已實現損益
- 剩餘未實現損益

---

## 16. 存放位置管理

可建立：

- 家中保險箱
- 銀行保管箱
- 其他安全存放處
- 暫時送驗位置

每個位置包含：

- 顯示名稱
- 類型
- 一般描述
- 加密敏感描述
- 備註
- 是否啟用

Dashboard 預設僅顯示位置名稱，不顯示完整地址、分行或箱號。

---

## 17. 頁面資訊架構

```text
登入
初始化

Dashboard
├── 資產總覽
├── 資產價值歷史
├── 配置分析
├── 溢價分析
└── 最近活動

市場與買點
├── 黃金歷史價格
├── 白銀歷史價格
├── 買點標記
├── 成本線與回本線
└── 歷史交易列表

資產
├── 全部資產
├── 黃金
├── 白銀
├── 資產詳情
└── 新增資產

交易
├── 購買紀錄
├── 售出紀錄
├── 其他異動
├── 新增購買
└── 新增售出

行情
├── 最新行情
├── 歷史行情
├── 商家報價
├── 資料來源狀態
└── 手動補價

文件
├── 全部附件
├── 發票與收據
├── 證書
├── 商品照片
└── 缺漏文件

設定
├── 帳號與安全性
├── Passkey
├── 顯示與單位
├── 金屬管理
├── 商品類型
├── 商家管理
├── 存放位置
├── 行情供應商
├── 回購估值規則
├── 排程
├── 備份與還原
└── 系統資訊
```

---

## 18. 技術架構

### 18.1 前端

建議技術：

- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- TanStack Query
- React Hook Form
- Zod
- Apache ECharts
- PWA

### 18.2 後端

後端必須使用 Node.js。

建議技術：

- Node.js
- TypeScript
- NestJS
- Prisma ORM
- PostgreSQL
- BullMQ
- Redis
- WebAuthn Library
- S3-compatible SDK

採用 NestJS 的原因：

- 模組化架構明確
- 適合後續擴充行情 Provider、排程、附件與估值模組
- 原生支援 Dependency Injection
- 適合建立 REST API
- 容易與 BullMQ、Redis、Prisma 整合

### 18.3 資料庫

- PostgreSQL
- 使用 NUMERIC／DECIMAL 儲存重量、價格、匯率與比例
- 使用 UTC 儲存所有時間
- 前端依使用者時區顯示
- 使用 Migration 管理 Schema

### 18.4 Object Storage

- MinIO
- Private Bucket
- S3-compatible API
- Signed URL

### 18.5 Background Jobs

- BullMQ Worker
- Redis Queue

工作類型包括：

- 最新行情同步
- 歷史行情同步
- 購買行情補齊
- 每小時估值快照
- 每日資產快照
- 附件縮圖
- 備份
- API 失敗重試

### 18.6 Reverse Proxy

- Nginx 或 Traefik
- HTTPS
- WebSocket／HTTP 支援
- 靜態檔案與 API 路由

---

## 19. 建議後端模組

```text
src/
├── auth/
├── passkeys/
├── account/
├── assets/
├── products/
├── purchases/
├── sales/
├── movements/
├── metals/
├── units/
├── dealers/
├── dealer-quotes/
├── market-prices/
├── price-providers/
├── valuations/
├── valuation-rules/
├── dashboards/
├── attachments/
├── storage-locations/
├── jobs/
├── audit/
├── settings/
├── backup/
└── health/
```

---

## 20. Docker 部署

### 20.1 Docker Compose 服務

```yaml
services:
  frontend:
  api:
  worker:
  scheduler:
  postgres:
  redis:
  minio:
  minio-init:
  nginx:
  backup:
```

### 20.2 Volume

至少需要：

- PostgreSQL Data
- MinIO Data
- Backup Output
- Nginx Certificates

### 20.3 環境變數

至少包含：

```text
APP_URL
API_URL
DATABASE_URL
REDIS_URL
SESSION_SECRET
ENCRYPTION_KEY
WEBAUTHN_RP_ID
WEBAUTHN_RP_NAME
WEBAUTHN_ORIGIN
MINIO_ENDPOINT
MINIO_ACCESS_KEY
MINIO_SECRET_KEY
MINIO_BUCKET
PRICE_PROVIDER
PRICE_PROVIDER_API_KEY
DEFAULT_CURRENCY
DEFAULT_TIMEZONE
DEFAULT_WEIGHT_UNIT
```

敏感值不得提交到 Git Repository。

---

## 21. 建議資料表

```text
app_user
user_passkeys
user_sessions

metals
product_definitions
assets
asset_identifiers
asset_movements
storage_locations

purchases
purchase_items
sales
sale_items

price_sources
spot_price_snapshots
fx_rate_snapshots
historical_price_candles

valuation_rules
asset_valuation_snapshots
portfolio_valuation_snapshots

dealers
dealer_quotes

attachments
attachment_links

system_settings
scheduled_job_runs
audit_logs
```

---

## 22. 主要 API 範圍

### 22.1 Auth

```text
POST /auth/login
POST /auth/logout
POST /auth/logout-all
GET  /auth/session
POST /auth/passkey/register/options
POST /auth/passkey/register/verify
POST /auth/passkey/login/options
POST /auth/passkey/login/verify
```

### 22.2 Account

```text
GET   /account
PATCH /account/username
PATCH /account/password
GET   /account/passkeys
PATCH /account/passkeys/:id
DELETE /account/passkeys/:id
```

### 22.3 Assets and Transactions

```text
GET    /assets
POST   /assets
GET    /assets/:id
PATCH  /assets/:id
GET    /purchases
POST   /purchases
GET    /purchases/:id
POST   /sales
POST   /assets/:id/movements
```

### 22.4 Market

```text
GET  /market/latest
GET  /market/history
GET  /market/chart
GET  /market/purchase-markers
POST /market/manual-price
GET  /market/providers/status
```

### 22.5 Dashboard

```text
GET /dashboard/summary
GET /dashboard/allocation
GET /dashboard/value-history
GET /dashboard/premium-analysis
GET /dashboard/market-purchase-points
```

### 22.6 Attachments

```text
POST   /attachments/upload-url
POST   /attachments/complete
GET    /attachments/:id/url
DELETE /attachments/:id
```

---

## 23. 安全需求

- 僅允許單一帳號
- 禁止公開註冊
- 密碼使用 Argon2id 雜湊
- 支援 Passkey
- 使用 HttpOnly Secure Cookie
- 防止 CSRF
- API Rate Limit
- 登入失敗暫時鎖定
- 所有附件使用私有儲存
- 敏感設定加密
- 所有修改操作寫入 Audit Log
- 禁止將密碼、API Key、Session Token 寫入 Log
- 提供健康檢查但不得暴露敏感資訊
- Production 必須使用 HTTPS
- WebAuthn Production 環境不得使用不安全的 HTTP Origin

---

## 24. 備份與還原

### 24.1 備份內容

- PostgreSQL
- MinIO 附件
- 系統設定
- 行情 Provider 設定
- 估值規則

### 24.2 備份策略

- 每日自動備份
- 可手動建立備份
- 備份檔加密
- 可設定保留天數
- 顯示最近備份時間與結果
- 支援完整還原流程

### 24.3 還原安全

還原前必須：

- 顯示影響範圍
- 要求重新驗證
- 建立還原前安全備份
- 記錄 Audit Log

---

## 25. Audit Log

即使是單一使用者，系統仍應保存重要異動紀錄，以便排查誤操作。

記錄內容：

- 時間
- 動作
- 資源類型
- 資源 ID
- 修改前摘要
- 修改後摘要
- IP
- User Agent
- Session ID
- 執行結果

不得在 Audit Log 中保存 password、Passkey private data 或完整 API Secret。

---

## 26. 非功能需求

### 26.1 響應式介面

- 桌面瀏覽器完整功能
- 手機可完成新增購買、拍照與快速查看
- 可安裝為 PWA

### 26.2 效能

- Dashboard 一般查詢在正常個人資料量下應於 2 秒內完成
- 資產列表支援分頁
- 歷史圖表使用時間粒度聚合，避免一次載入全部原始點位
- 附件使用縮圖，避免列表載入原圖

### 26.3 可觀測性

- API Health Check
- PostgreSQL Health Check
- Redis Health Check
- MinIO Health Check
- 行情 Provider 狀態
- 排程工作結果
- 結構化 Log

### 26.4 時區

- 資料庫統一使用 UTC
- 預設顯示時區為 Asia/Taipei
- 行情來源時間必須保留原始 timestamp

---

## 27. 第一版 MVP

MVP 完成後，使用者應能正式取代 Google Sheets。

### 27.1 MVP 必須完成

- 首次初始化單一帳號
- Username + Password 登入
- Passkey 註冊與 Touch ID 登入
- 使用者修改 username 與 password
- 黃金與白銀
- 商品定義
- 資產管理
- 購買交易
- 公克、公斤、金衡盎司、台錢輸入及切換
- 純度與純金屬重量
- 照片、證書及發票上傳
- 手動行情
- 至少一個自動行情 Provider
- 購入當下行情快照
- 基本資產 Dashboard
- 黃金及白銀歷史價格圖
- 買點標記
- 基本溢價與損益計算
- Docker Compose 部署
- PostgreSQL 備份
- MinIO 備份

### 27.2 MVP 可延後

- 自動商家回購價
- 複雜回購規則
- 部分售出
- 完整已實現損益
- PDF 報告
- CSV／Excel 匯入
- 多行情 Provider 自動切換
- 高級分析圖表

---

## 28. 開發階段

### Phase 1：核心資產記錄

- 專案基礎架構
- Docker Compose
- 單一帳號初始化
- Password 登入
- Passkey 登入
- Product、Asset、Purchase
- 單位轉換
- 附件上傳
- 基本 Dashboard

### Phase 2：行情與歷史買點

- Price Provider
- 即時行情
- 歷史行情
- 匯率
- 購入行情快照
- 市場歷史頁
- 買點標記
- 加權成本線
- 價值歷史圖

### Phase 3：溢價與回購估值

- 商家管理
- 商家報價
- 回購規則
- 預估可變現價值
- 回本線
- 溢價分析

### Phase 4：完整生命週期

- 售出
- 部分售出
- 已實現損益
- 贈與與遺失
- 存放位置異動
- 盤點
- 報表
- 匯入匯出

### Phase 5：維運與強化

- 完整備份還原 UI
- 多 Provider 備援
- 告警
- 行動版體驗強化
- 高級分析

---

## 29. MVP 驗收條件

### 29.1 登入

- 使用者可使用 username + password 登入。
- 使用者可在 Mac 上註冊 Passkey。
- 使用者可透過 Touch ID 使用 Passkey 登入。
- 使用者可修改 username 與 password。
- 系統不提供新增第二位使用者的功能。

### 29.2 購買紀錄

- 使用者可建立一筆包含至少一個商品的購買交易。
- 使用者可輸入 g、kg、oz 或台錢。
- 儲存後資料庫以公克保存。
- 系統正確計算純金屬重量。
- 使用者可上傳商品照片與發票。

### 29.3 Dashboard

- 顯示總成本、內含價值、損益與持有重量。
- 使用者切換重量單位後，相關數據同步更新。
- 黃金與白銀可分開查看。

### 29.4 市場歷史與買點

- 使用者可查看黃金歷史價格。
- 使用者可查看白銀歷史價格。
- 每筆購買交易會顯示在正確日期的圖表買點上。
- 點擊買點可查看商品、重量、購入價格與溢價。
- 圖表可切換 g、kg、oz 與台錢價格單位。

### 29.5 部署

- 執行 Docker Compose 後可啟動完整系統。
- PostgreSQL、Redis、MinIO、API、Worker 與 Frontend 可正常連線。
- 重啟容器後資料與附件不會遺失。

---

## 30. 已確認決策

| 項目 | 決策 |
|---|---|
| 系統名稱 | Bullion Ledger |
| 使用人數 | 單一使用者 |
| 後端 | Node.js + TypeScript |
| 建議框架 | NestJS |
| 資料庫 | PostgreSQL |
| Object Storage | MinIO |
| Queue | Redis + BullMQ |
| 登入 | Username／Password + Passkey |
| Touch ID | 透過 WebAuthn Passkey 支援 |
| 部署 | Docker Compose |
| 初期金屬 | 黃金、白銀 |
| 內部重量單位 | 公克 |
| 顯示重量單位 | g、kg、troy oz、台錢 |
| 歷史行情圖 | 必須提供 |
| 購買買點標記 | 必須提供 |
| 多帳號管理 | 不需要 |

---

## 31. 可設定但尚未鎖定的項目

下列項目不阻礙系統架構及第一階段開發，可在後續文件中確認：

- 第一個正式使用的行情 Provider
- 預設基準幣別是否固定為 TWD
- 是否同時顯示 USD 與 TWD
- 歷史行情保存的最細時間粒度
- 商家回購價以手動輸入或特定 API 為主
- 備份目標是否只存本機，或同步到 NAS／雲端
- 是否需要將敏感存放位置欄位做應用層加密
- 前端視覺風格與品牌識別

---

## 32. 後續文件規劃

建議依序建立：

1. `02_SYSTEM_ARCHITECTURE.md`
2. `03_DATABASE_SCHEMA.md`
3. `04_AUTH_AND_PASSKEY.md`
4. `05_ASSET_AND_TRANSACTION_MANAGEMENT.md`
5. `06_MARKET_PRICE_AND_VALUATION.md`
6. `07_DASHBOARD_AND_ANALYTICS.md`
7. `08_ATTACHMENT_MANAGEMENT.md`
8. `09_API_SPECIFICATION.md`
9. `10_DOCKER_DEPLOYMENT.md`
10. `11_BACKUP_SECURITY_AND_OPERATIONS.md`

---

## 33. 核心產品原則

Bullion Ledger 的第一優先不是提供最多功能，而是確保每次購入實體貴金屬後，使用者可以快速且完整地記錄：

- 買了什麼
- 何時購買
- 從哪裡購買
- 重量與純度
- 實際支付成本
- 購入當下行情
- 支付的溢價
- 商品照片與證明

並能隨時從 Dashboard 與市場歷史圖上看見：

- 目前持有量
- 目前價值
- 預估可變現價值
- 累計損益
- 自己買在歷史價格的哪一個位置

