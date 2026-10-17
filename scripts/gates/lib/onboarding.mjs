/**
 * 关掉首次启动的 onboarding 弹层。
 *
 * 0.2.0 的 keyless 引导与 0.2.1 的 desktop onboarding 是两套文案/按钮：
 *   0.2.1：Welcome（Get started）→ 额度（Add credits / Next / Skip）
 *          → 目的/过程（Continue / Open app / Skip）→ 跳过确认（Continue setup / Skip）
 *   0.2.0：Continue / Configure later
 *
 * 策略：只走**最短可跳过路径**——Welcome → Skip → Skip/Got it。每条候选都带中英文；
 * 每轮只点一个，避免误点“Add credits”这种需要外部的动作。弹层不存在时立即返回。
 */
export async function dismissOnboarding(page, { timeoutMs = 30_000 } = {}) {
  // 等到「有任意弹层」或超时：0.2.1 的登录弹层（Get started / Sign in / Add API Key）
  // 和 onboarding 弹层都可能出现，不能只等 welcome 按钮。
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await page.locator('[role="dialog"]').count() > 0) break
    await page.waitForTimeout(500)
  }

  const welcome = page.getByRole('button', { name: /^(Get started|开始设置)$/ }).first()
  if (await welcome.count() > 0) {
    try {
      await welcome.click({ timeout: 10_000 })
      await page.waitForTimeout(800)
    } catch {
      // 可能已经被别的路径跳过；继续看确认层。
    }
  }

  const candidates = [
    'Skip', '跳过',
    'Got it', '我知道了',
    'Next', '下一步',
    'Continue', '继续',
    'Open app', '进入应用',
    'Configure later', '稍后配置',
  ]
  for (let round = 0; round < 12; round++) {
    if (await page.locator('[role="dialog"]').count() === 0) break
    let clicked = false
    for (const name of candidates) {
      const button = page.getByRole('button', { name, exact: true }).first()
      if (await button.count() === 0) continue
      if (await button.isDisabled().catch(() => true)) continue
      try {
        await button.click({ timeout: 3_000 })
        clicked = true
        await page.waitForTimeout(700)
        break
      } catch {
        // 被遮挡/动画中：试下一个候选。
      }
    }
    if (!clicked) break
  }

  // 登录弹层（0.2.1 的 keyless 形态）没有 Skip，只有一个 X（aria-label Close|关闭）。
  // 关掉它之后 composer 才会露出来；模型调用仍会因无 key 失败——这正是门的预期。
  const close = page.getByRole('dialog').getByRole('button', { name: /^(Close|关闭)$/ }).first()
  if (await close.count() > 0) {
    try {
      await close.click({ timeout: 3_000 })
      await page.waitForTimeout(600)
    } catch {
      // 已经关了 / 被别的层挡着。
    }
  }

  // 弹层卸载动画收尾。
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await page.locator('[role="dialog"]').count() === 0) return
    await page.waitForTimeout(250)
  }
}
