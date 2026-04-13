/**
 * 钉钉环境检测工具
 * 在钉钉内置浏览器中，target="_blank" 会触发系统默认浏览器打开链接，
 * 导致用户脱离钉钉工作流。此模块提供检测函数，供各组件按环境调整链接行为。
 */

let _cached: boolean | null = null

/** 检测当前是否在钉钉内置浏览器中运行 */
export function isInDingTalk(): boolean {
  if (typeof navigator === 'undefined') return false
  if (_cached === null) {
    _cached = /DingTalk/i.test(navigator.userAgent)
  }
  return _cached
}

/** 根据环境返回链接 target：钉钉中返回 undefined（当前窗口），外部浏览器返回 '_blank' */
export function linkTarget(): '_blank' | undefined {
  return isInDingTalk() ? undefined : '_blank'
}
