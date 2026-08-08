import AppKit
import Foundation
import Vision

guard CommandLine.arguments.count == 2 else {
    fputs("usage: swift decode-qr.swift <image>\n", stderr)
    exit(2)
}

let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let image = NSImage(contentsOf: url),
      let data = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: data),
      let cgImage = bitmap.cgImage else {
    fputs("could not load image\n", stderr)
    exit(3)
}

let request = VNDetectBarcodesRequest()
request.symbologies = [.qr]
let handler = VNImageRequestHandler(cgImage: cgImage)
try handler.perform([request])

let payloads = (request.results ?? []).compactMap(\.payloadStringValue)
guard !payloads.isEmpty else {
    fputs("no QR payload found\n", stderr)
    exit(4)
}

for payload in payloads {
    print(payload)
}
