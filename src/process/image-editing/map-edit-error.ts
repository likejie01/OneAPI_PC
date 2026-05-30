export function mapImageEditError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '未知错误')
  const lower = message.toLowerCase()

  if (/not support|不支持.*编辑/.test(message)) {
    return '当前模型或渠道不支持图片编辑'
  }
  if (/multipart|boundary|form data/.test(lower)) {
    return '图片编辑请求格式无效'
  }
  if (/did not return any image output|no image output|未返回.*图片/.test(lower)) {
    return '图片编辑服务器未返回图片，请调整提示词或更换可编辑图片模型/渠道'
  }
  if (/401|403|unauthorized|forbidden/.test(lower)) {
    return '图片编辑鉴权失败'
  }
  if (/timeout|timed out|504|524/.test(lower)) {
    return '图片编辑服务器超时'
  }
  if (/channel|route|upstream|provider/.test(lower)) {
    return '图片编辑通道未正确启用'
  }
  return `图片编辑失败：${message}`
}
