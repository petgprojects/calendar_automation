// Developer-only PDF rendering using built-in macOS frameworks.
import AppKit
import PDFKit
import Foundation
let input=CommandLine.arguments[1]
let output=CommandLine.arguments[2]
try FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true)
for name in try FileManager.default.contentsOfDirectory(atPath: input).filter({$0.hasSuffix(".pdf")}).sorted() {
 guard let doc=PDFDocument(url: URL(fileURLWithPath: input+"/"+name)) else { fatalError("Invalid PDF: "+name) }
 print("\(name): \(doc.pageCount) pages")
 try (doc.string ?? "").write(toFile: output+"/"+name+".txt", atomically: true, encoding: .utf8)
 for i in 0..<doc.pageCount {
  guard let page=doc.page(at:i) else { continue }
  let image=page.thumbnail(of: NSSize(width:900,height:1200),for:.mediaBox)
  let bitmap=NSBitmapImageRep(data:image.tiffRepresentation!)!
  let png=bitmap.representation(using:.png,properties:[:])!
  let target=URL(fileURLWithPath:output+"/"+name.replacingOccurrences(of:".pdf",with:"")+"-\(i+1).png")
  try png.write(to:target)
 }
}
