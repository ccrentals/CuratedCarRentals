import { siteContent } from "@/data/content";

type PdfColor = [number, number, number];

export type AdminExportPdfColumn = {
  label: string;
  width: number;
  align?: "left" | "right";
};

export type AdminExportPdfSummaryCard = {
  label: string;
  value: string;
};

export type AdminExportPdfOptions = {
  title: string;
  subtitle?: string | null;
  metadata?: string[];
  summary?: AdminExportPdfSummaryCard[];
  columns: AdminExportPdfColumn[];
  rows: string[][];
  emptyState?: string;
  footerNote?: string | null;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const PAGE_MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const HEADER_BAR_COLOR: PdfColor = [0.090, 0.545, 0.510];
const HEADER_TEXT_COLOR: PdfColor = [0.078, 0.118, 0.216];
const BODY_TEXT_COLOR: PdfColor = [0.082, 0.094, 0.122];
const MUTED_TEXT_COLOR: PdfColor = [0.329, 0.423, 0.553];
const SURFACE_FILL: PdfColor = [0.972, 0.976, 0.984];
const ALT_ROW_FILL: PdfColor = [0.988, 0.992, 0.996];
const TABLE_HEADER_FILL: PdfColor = [0.121, 0.176, 0.302];
const TABLE_HEADER_TEXT: PdfColor = [0.969, 0.976, 1.0];
const BORDER_COLOR: PdfColor = [0.820, 0.855, 0.910];
const BADGE_FILL: PdfColor = [0.753, 0.510, 0.071];
const BADGE_TEXT: PdfColor = [0.969, 0.976, 1.0];
const SUMMARY_FILL: PdfColor = [0.905, 0.949, 0.929];

function sanitizePdfText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E]/g, "?");
}

function wrapLine(line: string, maxChars = 84) {
  const clean = line.trimEnd();
  if (clean.length <= maxChars) return [clean];

  const wrapped: string[] = [];
  let cursor = clean;
  while (cursor.length > maxChars) {
    const splitAt = cursor.lastIndexOf(" ", maxChars);
    const index = splitAt > 0 ? splitAt : maxChars;
    wrapped.push(cursor.slice(0, index));
    cursor = cursor.slice(index).trimStart();
  }
  if (cursor.length > 0) wrapped.push(cursor);
  return wrapped;
}

function fitCellText(value: string, width: number, fontSize: number) {
  const maxChars = Math.max(4, Math.floor((width - 12) / (fontSize * 0.54)));
  const safe = String(value ?? "").replace(/\s+/g, " ").trim();
  if (safe.length <= maxChars) return safe;
  return `${safe.slice(0, Math.max(1, maxChars - 3)).trimEnd()}...`;
}

function formatRgb(color: PdfColor) {
  return color.map((value) => value.toFixed(3)).join(" ");
}

function estimateTextWidth(text: string, fontSize: number) {
  return sanitizePdfText(text).length * fontSize * 0.54;
}

function pushRect(input: {
  commands: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  fill: PdfColor;
  stroke?: PdfColor;
  lineWidth?: number;
}) {
  input.commands.push(`${formatRgb(input.fill)} rg`);
  if (input.stroke) {
    input.commands.push(`${formatRgb(input.stroke)} RG`);
    input.commands.push(`${Math.max(0.1, Number(input.lineWidth ?? 1)).toFixed(2)} w`);
  }
  input.commands.push(
    `${input.x.toFixed(2)} ${input.y.toFixed(2)} ${input.width.toFixed(2)} ${input.height.toFixed(2)} re`,
  );
  input.commands.push(input.stroke ? "B" : "f");
}

function pushLine(input: {
  commands: string[];
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: PdfColor;
  lineWidth?: number;
}) {
  input.commands.push(`${formatRgb(input.stroke)} RG`);
  input.commands.push(`${Math.max(0.1, Number(input.lineWidth ?? 0.5)).toFixed(2)} w`);
  input.commands.push(
    `${input.x1.toFixed(2)} ${input.y1.toFixed(2)} m ${input.x2.toFixed(2)} ${input.y2.toFixed(2)} l S`,
  );
}

function pushText(input: {
  commands: string[];
  x: number;
  y: number;
  lines: string[];
  font: "F1" | "F2";
  fontSize: number;
  color: PdfColor;
  lineHeight?: number;
}) {
  const printable = input.lines.filter((line) => line.length > 0);
  if (printable.length === 0) return;

  input.commands.push("BT");
  input.commands.push(`/${input.font} ${input.fontSize.toFixed(2)} Tf`);
  input.commands.push(`${formatRgb(input.color)} rg`);
  input.commands.push(`${input.x.toFixed(2)} ${input.y.toFixed(2)} Td`);
  input.commands.push(`${(input.lineHeight ?? input.fontSize * 1.35).toFixed(2)} TL`);
  printable.forEach((line, index) => {
    input.commands.push(`(${sanitizePdfText(line)}) Tj`);
    if (index < printable.length - 1) input.commands.push("T*");
  });
  input.commands.push("ET");
}

function buildMultiPagePdf(pageCommands: string[][]) {
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  const pageRefs: string[] = [];
  let nextObjectId = 5;

  for (const commands of pageCommands) {
    const pageId = nextObjectId++;
    const contentId = nextObjectId++;
    pageRefs.push(`${pageId} 0 R`);

    const stream = commands.join("\n");
    const contentLength = Buffer.byteLength(stream, "ascii");
    objects[contentId] = `<< /Length ${contentLength} >>\nstream\n${stream}\nendstream`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
  }

  objects[2] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageRefs.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  const maxObjectId = objects.length - 1;

  for (let id = 1; id <= maxObjectId; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, "ascii");
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${maxObjectId + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let id = 1; id <= maxObjectId; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "ascii");
}

function drawBrandBadge(commands: string[], x: number, y: number) {
  pushRect({
    commands,
    x,
    y,
    width: 42,
    height: 42,
    fill: BADGE_FILL,
  });
  pushText({
    commands,
    x: x + 8,
    y: y + 27,
    lines: ["CCR"],
    font: "F2",
    fontSize: 14,
    color: BADGE_TEXT,
  });
}

function buildPageCommands(input: {
  options: AdminExportPdfOptions;
  pageRows: string[][];
  pageIndex: number;
  totalPages: number;
  firstPage: boolean;
}) {
  const { options, pageRows, pageIndex, totalPages, firstPage } = input;
  const commands: string[] = [];

  pushRect({
    commands,
    x: PAGE_MARGIN,
    y: 794,
    width: CONTENT_WIDTH,
    height: 8,
    fill: HEADER_BAR_COLOR,
  });

  drawBrandBadge(commands, PAGE_MARGIN, 736);

  pushText({
    commands,
    x: 94,
    y: 772,
    lines: [options.title],
    font: "F2",
    fontSize: 24,
    color: HEADER_TEXT_COLOR,
  });

  if (options.subtitle) {
    pushText({
      commands,
      x: 94,
      y: 750,
      lines: wrapLine(options.subtitle, 54),
      font: "F1",
      fontSize: 10,
      color: MUTED_TEXT_COLOR,
      lineHeight: 12,
    });
  }

  pushText({
    commands,
    x: 360,
    y: 770,
    lines: [siteContent.brand],
    font: "F2",
    fontSize: 12,
    color: HEADER_TEXT_COLOR,
  });

  pushText({
    commands,
    x: 360,
    y: 753,
    lines: [siteContent.email, siteContent.phone],
    font: "F1",
    fontSize: 9,
    color: MUTED_TEXT_COLOR,
    lineHeight: 11,
  });

  const pageLabel = `Page ${pageIndex + 1} of ${totalPages}`;

  let tableTopY = 690;

  if (firstPage) {
    const metadataLines = (options.metadata ?? []).flatMap((line) => wrapLine(line, 92));
    if (metadataLines.length > 0) {
      pushText({
        commands,
        x: PAGE_MARGIN,
        y: 706,
        lines: metadataLines,
        font: "F1",
        fontSize: 10,
        color: MUTED_TEXT_COLOR,
        lineHeight: 13,
      });
      tableTopY -= metadataLines.length * 13 + 14;
    }

    const summaryCards = options.summary ?? [];
    if (summaryCards.length > 0) {
      const cardsPerRow = 3;
      const cardGap = 12;
      const cardWidth = (CONTENT_WIDTH - cardGap * (cardsPerRow - 1)) / cardsPerRow;
      const cardHeight = 54;
      let currentTop = tableTopY;

      for (let index = 0; index < summaryCards.length; index += cardsPerRow) {
        const row = summaryCards.slice(index, index + cardsPerRow);
        row.forEach((card, cardIndex) => {
          const x = PAGE_MARGIN + cardIndex * (cardWidth + cardGap);
          pushRect({
            commands,
            x,
            y: currentTop - cardHeight,
            width: cardWidth,
            height: cardHeight,
            fill: SUMMARY_FILL,
            stroke: BORDER_COLOR,
          });
          pushText({
            commands,
            x: x + 12,
            y: currentTop - 20,
            lines: [card.label.toUpperCase()],
            font: "F1",
            fontSize: 8,
            color: MUTED_TEXT_COLOR,
          });
          pushText({
            commands,
            x: x + 12,
            y: currentTop - 38,
            lines: [card.value],
            font: "F2",
            fontSize: 13,
            color: HEADER_TEXT_COLOR,
          });
        });
        currentTop -= cardHeight + 12;
      }

      tableTopY = currentTop - 8;
    }
  }

  const headerHeight = 24;
  const rowHeight = 22;
  const cellFontSize = 8.5;

  pushRect({
    commands,
    x: PAGE_MARGIN,
    y: tableTopY - headerHeight,
    width: CONTENT_WIDTH,
    height: headerHeight,
    fill: TABLE_HEADER_FILL,
  });

  let cursorX = PAGE_MARGIN;
  options.columns.forEach((column) => {
    pushText({
      commands,
      x: cursorX + 7,
      y: tableTopY - 16,
      lines: [column.label.toUpperCase()],
      font: "F2",
      fontSize: 8,
      color: TABLE_HEADER_TEXT,
    });
    cursorX += column.width;
  });

  let dividerX = PAGE_MARGIN;
  options.columns.slice(0, -1).forEach((column) => {
    dividerX += column.width;
    pushLine({
      commands,
      x1: dividerX,
      y1: tableTopY - headerHeight,
      x2: dividerX,
      y2: tableTopY,
      stroke: TABLE_HEADER_TEXT,
      lineWidth: 0.35,
    });
  });

  let currentY = tableTopY - headerHeight;

  if (pageRows.length === 0) {
    pushRect({
      commands,
      x: PAGE_MARGIN,
      y: currentY - rowHeight,
      width: CONTENT_WIDTH,
      height: rowHeight,
      fill: SURFACE_FILL,
      stroke: BORDER_COLOR,
    });
    pushText({
      commands,
      x: PAGE_MARGIN + 8,
      y: currentY - 15,
      lines: [options.emptyState ?? "No records found."],
      font: "F1",
      fontSize: 9,
      color: MUTED_TEXT_COLOR,
    });
  } else {
    pageRows.forEach((row, rowIndex) => {
      const fill = rowIndex % 2 === 0 ? SURFACE_FILL : ALT_ROW_FILL;
      pushRect({
        commands,
        x: PAGE_MARGIN,
        y: currentY - rowHeight,
        width: CONTENT_WIDTH,
        height: rowHeight,
        fill,
        stroke: BORDER_COLOR,
        lineWidth: 0.5,
      });

      let cellX = PAGE_MARGIN;
      options.columns.forEach((column, columnIndex) => {
        const rawCell = row[columnIndex] ?? "";
        const cellText = fitCellText(rawCell, column.width, cellFontSize);
        const textX =
          column.align === "right"
            ? cellX + column.width - 8 - estimateTextWidth(cellText, cellFontSize)
            : cellX + 8;

        pushText({
          commands,
          x: textX,
          y: currentY - 15,
          lines: [cellText],
          font: column.align === "right" ? "F2" : "F1",
          fontSize: cellFontSize,
          color: BODY_TEXT_COLOR,
        });
        cellX += column.width;
      });

      let rowDividerX = PAGE_MARGIN;
      options.columns.slice(0, -1).forEach((column) => {
        rowDividerX += column.width;
        pushLine({
          commands,
          x1: rowDividerX,
          y1: currentY - rowHeight,
          x2: rowDividerX,
          y2: currentY,
          stroke: BORDER_COLOR,
          lineWidth: 0.25,
        });
      });

      currentY -= rowHeight;
    });
  }

  if (options.footerNote) {
    pushText({
      commands,
      x: PAGE_MARGIN,
      y: 34,
      lines: [options.footerNote],
      font: "F1",
      fontSize: 8,
      color: MUTED_TEXT_COLOR,
    });
  }

  pushText({
    commands,
    x: PAGE_WIDTH - PAGE_MARGIN - estimateTextWidth(pageLabel, 8),
    y: 34,
    lines: [pageLabel],
    font: "F1",
    fontSize: 8,
    color: MUTED_TEXT_COLOR,
  });

  return commands;
}

export function buildAdminExportPdf(options: AdminExportPdfOptions) {
  const safeRows = options.rows;
  const firstPageCapacity = Math.max(1, Math.floor((520 - 56) / 22));
  const laterPageCapacity = Math.max(1, Math.floor((690 - 56) / 22));

  const pages: string[][][] = [];
  let cursor = 0;

  pages.push(safeRows.slice(cursor, cursor + firstPageCapacity));
  cursor += firstPageCapacity;

  while (cursor < safeRows.length) {
    pages.push(safeRows.slice(cursor, cursor + laterPageCapacity));
    cursor += laterPageCapacity;
  }

  if (pages.length === 0) {
    pages.push([]);
  }

  const pageCommands = pages.map((pageRows, pageIndex) =>
    buildPageCommands({
      options,
      pageRows,
      pageIndex,
      totalPages: pages.length,
      firstPage: pageIndex === 0,
    }),
  );

  return buildMultiPagePdf(pageCommands);
}
