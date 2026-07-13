import { escapeXml, pxToEmu } from "../xml";
import { xfrmXml, rectGeometryXml, ellipseGeometryXml, fillXml, strokeXml, effectsXml } from "./shapeProps";
import { textBodyXml, emptyTextBodyXml } from "./textBody";
import type { ShapeInput, LineShapeInput, StrokeInput, LineCap } from "../types";

function nvSpPr(id: number, name: string | undefined): string {
  return `<p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(name ?? `Shape ${id}`)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`;
}

const CAP_TYPE: Record<Exclude<LineCap, "none">, string> = {
  arrow: "arrow",
  triangle: "triangle",
  circle: "oval",
  bar: "stealth", // closest preset; DrawingML has no flat "bar" end
};

function lineStrokeXml(stroke: StrokeInput, startCap?: LineCap, endCap?: LineCap): string {
  const head = startCap && startCap !== "none" ? `<a:headEnd type="${CAP_TYPE[startCap]}"/>` : "";
  const tail = endCap && endCap !== "none" ? `<a:tailEnd type="${CAP_TYPE[endCap]}"/>` : "";
  const alphaXml = stroke.alpha >= 1 ? "" : `<a:alpha val="${Math.round(stroke.alpha * 100000)}"/>`;
  return (
    `<a:ln w="${pxToEmu(stroke.widthPx)}">` +
    `<a:solidFill><a:srgbClr val="${stroke.rgb}">${alphaXml}</a:srgbClr></a:solidFill>` +
    head +
    tail +
    "</a:ln>"
  );
}

function lineXml(shape: LineShapeInput, id: number): string {
  const x = Math.min(shape.x1, shape.x2);
  const y = Math.min(shape.y1, shape.y2);
  const w = Math.abs(shape.x2 - shape.x1);
  const h = Math.abs(shape.y2 - shape.y1);
  const flipH = shape.x2 < shape.x1 ? ' flipH="1"' : "";
  const flipV = shape.y2 < shape.y1 ? ' flipV="1"' : "";
  return (
    "<p:sp>" +
    nvSpPr(id, shape.name) +
    "<p:spPr>" +
    `<a:xfrm${flipH}${flipV}><a:off x="${pxToEmu(x)}" y="${pxToEmu(y)}"/><a:ext cx="${pxToEmu(w)}" cy="${pxToEmu(h)}"/></a:xfrm>` +
    '<a:prstGeom prst="line"><a:avLst/></a:prstGeom>' +
    lineStrokeXml(shape.stroke, shape.startCap, shape.endCap) +
    "</p:spPr>" +
    emptyTextBodyXml() +
    "</p:sp>"
  );
}

export function shapeXml(shape: ShapeInput, id: number, mediaRelId?: string): string {
  switch (shape.kind) {
    case "rect":
      return (
        "<p:sp>" +
        nvSpPr(id, shape.name) +
        "<p:spPr>" +
        xfrmXml(shape.rect, shape.rotationDeg) +
        rectGeometryXml(shape.rect, shape.cornerRadii) +
        fillXml(shape.fill) +
        strokeXml(shape.stroke) +
        effectsXml(shape.shadows) +
        "</p:spPr>" +
        emptyTextBodyXml() +
        "</p:sp>"
      );
    case "ellipse":
      return (
        "<p:sp>" +
        nvSpPr(id, shape.name) +
        "<p:spPr>" +
        xfrmXml(shape.rect, shape.rotationDeg) +
        ellipseGeometryXml() +
        fillXml(shape.fill) +
        strokeXml(shape.stroke) +
        effectsXml(shape.shadows) +
        "</p:spPr>" +
        emptyTextBodyXml() +
        "</p:sp>"
      );
    case "line":
      return lineXml(shape, id);
    case "text":
      return (
        "<p:sp>" +
        nvSpPr(id, shape.name) +
        "<p:spPr>" +
        xfrmXml(shape.rect, shape.rotationDeg) +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
        "<a:noFill/>" +
        "</p:spPr>" +
        textBodyXml(shape) +
        "</p:sp>"
      );
    case "picture": {
      if (!mediaRelId) throw new Error("picture shape requires a mediaRelId");
      return (
        "<p:pic>" +
        `<p:nvPicPr><p:cNvPr id="${id}" name="${escapeXml(shape.name ?? `Picture ${id}`)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
        `<p:blipFill><a:blip r:embed="${mediaRelId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
        "<p:spPr>" +
        xfrmXml(shape.rect, shape.rotationDeg) +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
        "</p:spPr>" +
        "</p:pic>"
      );
    }
  }
}
