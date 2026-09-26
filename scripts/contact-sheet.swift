import AppKit
import Foundation
let dir=CommandLine.arguments[1]
let names=try FileManager.default.contentsOfDirectory(atPath:dir).filter{$0.hasSuffix(".png") && !$0.hasPrefix("contact-")}.sorted()
let width=1000, cellW=250, cellH=350, height=((names.count+3)/4)*350
let image=NSImage(size:NSSize(width:width,height:height))
image.lockFocus()
NSColor.white.setFill();NSRect(x:0,y:0,width:width,height:height).fill()
for (i,name) in names.enumerated(){
 let x=(i%4)*cellW,y=height-(i/4+1)*cellH
 if let img=NSImage(contentsOfFile:dir+"/"+name){img.draw(in:NSRect(x:x+4,y:y+22,width:242,height:320))}
 (name as NSString).draw(in:NSRect(x:x+5,y:y+2,width:240,height:20),withAttributes:[.font:NSFont.systemFont(ofSize:8),.foregroundColor:NSColor.black])
}
image.unlockFocus()
let bitmap=NSBitmapImageRep(data:image.tiffRepresentation!)!
try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:dir+"/contact-sheet.png"))
