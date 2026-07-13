import { zipSync, strToU8 } from "fflate";

import { pxToEmu } from "./xml";

export const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** The empty shape-tree scaffolding every cSld needs. */
export const EMPTY_SPTREE_HEADER =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
  '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function contentTypesXml(slideCount: number, mediaNames: string[]): string {
  const hasPng = mediaNames.some((n) => n.endsWith(".png"));
  const hasJpeg = mediaNames.some((n) => n.endsWith(".jpeg"));
  const slides = Array.from(
    { length: slideCount },
    (_, i) =>
      `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
  ).join("");
  return (
    XML_DECL +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    (hasPng ? '<Default Extension="png" ContentType="image/png"/>' : "") +
    (hasJpeg ? '<Default Extension="jpeg" ContentType="image/jpeg"/>' : "") +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    slides +
    "</Types>"
  );
}

function rootRelsXml(): string {
  return (
    XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${REL_TYPE}/officeDocument" Target="ppt/presentation.xml"/>` +
    "</Relationships>"
  );
}

function presentationXml(widthPx: number, heightPx: number, slideCount: number): string {
  const slideIds = Array.from(
    { length: slideCount },
    (_, i) => `<p:sldId id="${256 + i}" r:id="rId${2 + i}"/>`,
  ).join("");
  return (
    XML_DECL +
    `<p:presentation ${NS}>` +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    `<p:sldIdLst>${slideIds}</p:sldIdLst>` +
    `<p:sldSz cx="${pxToEmu(widthPx)}" cy="${pxToEmu(heightPx)}"/>` +
    '<p:notesSz cx="6858000" cy="9144000"/>' +
    "</p:presentation>"
  );
}

function presentationRelsXml(slideCount: number): string {
  const slideRels = Array.from(
    { length: slideCount },
    (_, i) => `<Relationship Id="rId${2 + i}" Type="${REL_TYPE}/slide" Target="slides/slide${i + 1}.xml"/>`,
  ).join("");
  return (
    XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${REL_TYPE}/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
    slideRels +
    "</Relationships>"
  );
}

function slideMasterXml(): string {
  return (
    XML_DECL +
    `<p:sldMaster ${NS}>` +
    `<p:cSld><p:spTree>${EMPTY_SPTREE_HEADER}</p:spTree></p:cSld>` +
    '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
    "</p:sldMaster>"
  );
}

function slideMasterRelsXml(): string {
  return (
    XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${REL_TYPE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
    `<Relationship Id="rId2" Type="${REL_TYPE}/theme" Target="../theme/theme1.xml"/>` +
    "</Relationships>"
  );
}

function slideLayoutXml(): string {
  return (
    XML_DECL +
    `<p:sldLayout ${NS} type="blank">` +
    `<p:cSld><p:spTree>${EMPTY_SPTREE_HEADER}</p:spTree></p:cSld>` +
    "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>" +
    "</p:sldLayout>"
  );
}

function slideLayoutRelsXml(): string {
  return (
    XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${REL_TYPE}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>` +
    "</Relationships>"
  );
}

/** Minimal but schema-complete theme (PowerPoint refuses packages without one). */
function themeXml(): string {
  const fmt =
    '<a:fmtScheme name="Office">' +
    "<a:fillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:fillStyleLst>" +
    "<a:lnStyleLst>" +
    '<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'.repeat(3) +
    "</a:lnStyleLst>" +
    "<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>" +
    "<a:bgFillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:bgFillStyleLst>" +
    "</a:fmtScheme>";
  return (
    XML_DECL +
    '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="pen">' +
    "<a:themeElements>" +
    '<a:clrScheme name="pen">' +
    '<a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>' +
    '<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
    '<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>' +
    '<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
    '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>' +
    '<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>' +
    "</a:clrScheme>" +
    '<a:fontScheme name="pen"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
    '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
    fmt +
    "</a:themeElements>" +
    "</a:theme>"
  );
}

export interface PptxPackageInput {
  widthPx: number;
  heightPx: number;
  slideXmls: string[]; // full XML of ppt/slides/slideN.xml, index 0 = slide1
  slideRels: string[]; // full XML of ppt/slides/_rels/slideN.xml.rels
  media: { name: string; bytes: Uint8Array }[]; // lands at ppt/media/<name>
}

export function buildPptxPackage(input: PptxPackageInput): Uint8Array {
  const { widthPx, heightPx, slideXmls, slideRels, media } = input;
  if (slideXmls.length === 0) throw new Error("buildPptxPackage requires at least one slide");
  if (slideXmls.length !== slideRels.length) throw new Error("slideXmls/slideRels length mismatch");

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypesXml(slideXmls.length, media.map((m) => m.name))),
    "_rels/.rels": strToU8(rootRelsXml()),
    "ppt/presentation.xml": strToU8(presentationXml(widthPx, heightPx, slideXmls.length)),
    "ppt/_rels/presentation.xml.rels": strToU8(presentationRelsXml(slideXmls.length)),
    "ppt/slideMasters/slideMaster1.xml": strToU8(slideMasterXml()),
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": strToU8(slideMasterRelsXml()),
    "ppt/slideLayouts/slideLayout1.xml": strToU8(slideLayoutXml()),
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": strToU8(slideLayoutRelsXml()),
    "ppt/theme/theme1.xml": strToU8(themeXml()),
  };
  slideXmls.forEach((xml, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(xml);
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = strToU8(slideRels[i]);
  });
  for (const m of media) files[`ppt/media/${m.name}`] = m.bytes;

  return zipSync(files);
}

export const OPC = { XML_DECL, REL_TYPE };
