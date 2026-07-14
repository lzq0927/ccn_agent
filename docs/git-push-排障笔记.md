# Git Push 排障笔记(国内/GFW 环境推送 github)

> 一次真实的推送故障排查记录:本地提交死活推不上 github,最后定位是**全局 git 死代理配置 + GFW 间歇重置**叠加。复盘经验,便于下次直接套用。

---

## 一、现象

`git push origin HEAD:develop` 一直失败,出现**两类**报错(区分它们是定位关键):

| 报错关键字 | 含义 |
|---|---|
| `Failed to connect ... via 127.0.0.1 ... Could not connect` | git 在走一个**本地代理**,但代理没运行 |
| `Recv failure: Connection was reset` | 直连 github 被 **GFW 重置** |

⚠️ `git fetch`/`pull` 走的是**同一条** github 连接——如果 push 挂,通常 pull 也会挂(不要被"以前 pull 过"误导,那只是当时网通)。

---

## 二、根因(两个独立问题叠加)

1. **全局 git 配置里有一条死代理**
   `C:\Users\<user>\.gitconfig` 写了 `http.proxy / https.proxy = http://127.0.0.1:7890`(Clash 默认端口),但机器上**根本没装/没开 Clash** → git 所有请求都打到 127.0.0.1:7890,连不上。
2. **GFW 对 github HTTPS(443)间歇性重置**
   即使清掉死代理直连,`github.com:443` 仍会被重置——**但封锁不是 100% 严密,会有偶尔的连通窗口**。

---

## 三、关键诊断命令(逐条都很有用)

```bash
# 1) 查【所有级别】的代理配置(含全局)——别只查仓库级,会漏
git config --list --show-origin | grep -i proxy

# 2) 看本地有没有代理在监听(常见端口:7890/7897/10809/1080/1087/8889)
netstat -ano | grep LISTENING | grep 127.0.0.1
# 或逐端口探活:
(echo > /dev/tcp/127.0.0.1/7890) 2>/dev/null && echo OPEN || echo closed

# 3) 验证远端【真实】状态(直接打 github,不会被本地 ref 误导)
git ls-remote origin develop      # 返回的 SHA 才是远端真相
git rev-parse HEAD                # 本地 HEAD;两者一致 = 真推上去了

# 4) 探 github 各通道是否通
curl -s -o /dev/null -w "%{http_code}\n" --max-time 8 https://github.com   # HTTPS
timeout 8 bash -c 'cat </dev/null >/dev/tcp/github.com/22' && echo SSH通   # SSH 22
```

> 经验:`git status` 显示的 "ahead N" 依赖**本地缓存的** `origin/develop` ref,可能滞后;判断"到底推上去没"一定要用 `git ls-remote` 查远端真值。

---

## 四、解决步骤(本次成功的路径)

```bash
# Step 1:清掉全局死代理(它是一切 "via 127.0.0.1" 报错的根源)
git config --global --unset http.proxy
git config --global --unset https.proxy

# Step 2:持续重试 push,撞 GFW 的连通窗口(直连封锁有泄漏窗口,多重试几次就能过)
for i in $(seq 1 30); do
  git push origin HEAD:develop 2>&1 | tail -3
  [ "$(git log --oneline origin/develop..HEAD | wc -l)" -eq 0 ] && echo "✅ 成功" && break
  sleep 1
done

# Step 3:用 ls-remote 确认真推上去了
git ls-remote origin develop    # SHA 与 git rev-parse HEAD 一致即成功
```

本次正是:**清死代理 + 重试循环第 1 次就抓住窗口**,凭 `credential.helper=manager` 里已存的 github 凭证直接推过(无需密钥)。

---

## 五、备选通道(本次没用上,但值得记)

- **SSH 22 端口其实通**:`ssh -T git@github.com` 能连上(只是没 key 被 permission denied)。GFW 通常封 443 不封 22。
  - 若已在 github 配过 SSH key,可改用 SSH 推:
    ```bash
    git remote set-url origin git@github.com:lzq0927/ccn_agent.git
    git push origin HEAD:develop
    ```
  - 限制:新 key 必须通过 github Web/API(HTTPS)添加,而 HTTPS 又被墙 → 新机器首次配 SSH key 在墙内是先有鸡先有蛋,得靠一台已通的外部设备。
- **挂代理**:装 Clash Verge / v2rayN + 订阅,启动后:
  ```bash
  git config --global http.proxy  http://127.0.0.1:7890
  git config --global https.proxy http://127.0.0.1:7890
  # 用完想还原:git config --global --unset http.proxy && git config --global --unset https.proxy
  ```
- **换网络**:手机热点 VPN / 公司 VPN / 另一台能直连的机器。

---

## 六、给未来自己的提醒

1. **删死代理**:卸载/换代理工具后,记得 `--unset` 掉旧的 `http.proxy/https.proxy`,否则 git 会一直往空端口打。
2. **github 直连不稳是常态**:push/fetch 偶发失败时,**先多重试几次**(撞窗口),别一失败就以为代码问题。
3. **判断成功用 `git ls-remote`**,别只看 `git status` 的 ahead/behind。
4. **认报错关键字**:`via 127.0.0.1` → 代理问题;`Connection was reset` → 直连被墙。两者解法完全不同,别混为一谈。
5. **凭据别丢**:`credential.helper=manager` 已存的 github token 让 HTTPS push 免输密钥——只要传输通就能直接推。

---

## 七、本次涉及的环境快照

- 远端:`https://github.com/lzq0927/ccn_agent.git`,分支 `develop`(本地 `local_dev` 上游指向 `origin/develop`)
- 推送方式:`git push origin HEAD:develop`(把本地 `local_dev` 推到远端 `develop`)
- 成功路径:清全局死代理 → 直连重试循环 → 撞 GFW 窗口 → 凭 credential helper 推过
- 验证:`git ls-remote origin develop` 返回 SHA 与本地 HEAD 完全一致
