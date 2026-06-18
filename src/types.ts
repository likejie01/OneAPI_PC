export interface DesktopImageEditRequest {
  apiKey: string
  userId?: string
  model: string
  prompt: string
  imageName: string
  mimeType?: string
  dataBase64: string
  size?: string
  quality?: string
  response_format?: 'url' | 'b64_json'
}
