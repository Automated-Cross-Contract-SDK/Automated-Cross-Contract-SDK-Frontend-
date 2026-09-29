// qrcode ships no type declarations; this covers the one call the example makes.
declare module 'qrcode' {
  const QRCode: { toCanvas(canvas: HTMLCanvasElement, text: string): Promise<void> }
  export default QRCode
}
