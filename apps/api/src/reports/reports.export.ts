import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { ReportsService } from './reports.service';

type Summary = Awaited<ReturnType<ReportsService['summary']>>;

const LABELS: Record<string, string> = {
  DEPOSIT: 'Deposit',
  PAYMENT: 'Payment',
  REFUND: 'Refund',
  CASH: 'Cash',
  EFT: 'EFT',
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  CHECKED_IN: 'Checked in',
  CHECKED_OUT: 'Checked out',
  CANCELLED: 'Cancelled',
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partially paid',
  FULLY_PAID: 'Fully paid',
  REFUND_DUE: 'Refund due',
};

/** DD/MM/YYYY */
export function formatDate(date: string) {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

export function formatRand(cents: number) {
  const sign = cents < 0 ? '-' : '';
  const [whole, frac] = (Math.abs(cents) / 100).toFixed(2).split('.');
  return `${sign}R ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${frac}`;
}

const rands = (cents: number) => cents / 100;
const ZAR_FORMAT = '"R" #,##0.00;[Red]-"R" #,##0.00';

export async function toExcel(r: Summary): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = r.business.name;
  wb.created = new Date();

  const summary = wb.addWorksheet('Summary');
  summary.columns = [{ width: 34 }, { width: 20 }];
  summary.addRows([
    [`${r.business.name} — Report`],
    [`Period: ${formatDate(r.from)} to ${formatDate(r.to)} (${r.days} days)`],
    [],
    ['Total received', rands(r.revenue.totalReceivedCents)],
    ['Cash', rands(r.revenue.cashCents)],
    ['EFT (verified)', rands(r.revenue.eftCents)],
    ['Refunds paid', rands(r.revenue.refundsCents)],
    ['EFT awaiting verification', rands(r.revenue.pendingEftCents)],
    ...(r.business.vatRegistered ? [['VAT included in receipts', rands(r.revenue.vatCents)]] : []),
    [],
    ['Bookings made', r.bookings.created],
    ['Bookings cancelled', r.bookings.cancelled],
    ['Room nights sold', r.occupancy.roomNightsSold],
    ['Room nights available', r.occupancy.roomNightsAvailable],
    ['Occupancy %', r.occupancy.occupancyPercent / 100],
    ['Average nightly rate', rands(r.occupancy.averageRateCents)],
  ]);
  summary.getRow(1).font = { bold: true, size: 14 };
  summary.getColumn(2).numFmt = ZAR_FORMAT;
  summary.eachRow((row) => {
    const label = String(row.getCell(1).value ?? '');
    if (/Bookings|Room nights/.test(label)) row.getCell(2).numFmt = '0';
    if (label === 'Occupancy %') row.getCell(2).numFmt = '0.0%';
  });

  const daily = wb.addWorksheet('Daily');
  daily.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Rooms occupied', key: 'occupiedRooms', width: 15 },
    { header: 'Arrivals', key: 'arrivals', width: 10 },
    { header: 'Departures', key: 'departures', width: 11 },
    { header: 'Cash', key: 'cash', width: 14, style: { numFmt: ZAR_FORMAT } },
    { header: 'EFT', key: 'eft', width: 14, style: { numFmt: ZAR_FORMAT } },
    { header: 'EFT pending', key: 'pending', width: 14, style: { numFmt: ZAR_FORMAT } },
  ];
  for (const d of r.daily) {
    daily.addRow({ ...d, date: formatDate(d.date), cash: rands(d.cashCents), eft: rands(d.eftCents), pending: rands(d.pendingEftCents) });
  }

  const rooms = wb.addWorksheet('Rooms');
  rooms.columns = [
    { header: 'Room', key: 'name', width: 20 },
    { header: 'Nights sold', key: 'nights', width: 12 },
    { header: 'Occupancy %', key: 'occ', width: 13, style: { numFmt: '0.0%' } },
    { header: 'Accommodation value', key: 'earned', width: 20, style: { numFmt: ZAR_FORMAT } },
  ];
  for (const room of r.occupancy.rooms) {
    rooms.addRow({ name: room.name, nights: room.nights, occ: room.occupancyPercent / 100, earned: rands(room.earnedCents) });
  }

  const payments = wb.addWorksheet('Payments');
  payments.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Booking', key: 'ref', width: 12 },
    { header: 'Guest', key: 'guest', width: 24 },
    { header: 'Room', key: 'room', width: 14 },
    { header: 'Type', key: 'type', width: 10 },
    { header: 'Method', key: 'method', width: 8 },
    { header: 'Amount', key: 'amount', width: 14, style: { numFmt: ZAR_FORMAT } },
    { header: 'Reference', key: 'reference', width: 18 },
    { header: 'Verified', key: 'verified', width: 9 },
    { header: 'Recorded by', key: 'by', width: 16 },
  ];
  for (const p of r.payments) {
    payments.addRow({
      date: formatDate(p.paymentDate),
      ref: p.bookingReference,
      guest: p.guestName,
      room: p.roomName,
      type: LABELS[p.type],
      method: LABELS[p.method],
      amount: rands(p.type === 'REFUND' ? -p.amountCents : p.amountCents),
      reference: p.reference ?? '',
      verified: p.verified ? 'Yes' : 'No',
      by: p.recordedBy,
    });
  }

  const outstanding = wb.addWorksheet('Outstanding');
  outstanding.columns = [
    { header: 'Booking', key: 'ref', width: 12 },
    { header: 'Guest', key: 'guest', width: 24 },
    { header: 'Phone', key: 'phone', width: 15 },
    { header: 'Room', key: 'room', width: 14 },
    { header: 'Check-in', key: 'in', width: 12 },
    { header: 'Check-out', key: 'out', width: 12 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Amount due', key: 'due', width: 14, style: { numFmt: ZAR_FORMAT } },
    { header: 'Paid', key: 'paid', width: 14, style: { numFmt: ZAR_FORMAT } },
    { header: 'Outstanding', key: 'outstanding', width: 14, style: { numFmt: ZAR_FORMAT } },
    { header: 'Payment status', key: 'ps', width: 15 },
  ];
  for (const o of r.outstanding) {
    outstanding.addRow({
      ref: o.reference,
      guest: o.guestName,
      phone: o.guestPhone,
      room: o.roomName,
      in: formatDate(o.checkIn),
      out: formatDate(o.checkOut),
      status: LABELS[o.status],
      due: rands(o.amountDueCents),
      paid: rands(o.paidCents),
      outstanding: rands(o.outstandingCents),
      ps: LABELS[o.paymentStatus],
    });
  }

  for (const ws of [daily, rooms, payments, outstanding]) {
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toPdf(r: Summary): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).font('Helvetica-Bold').text(r.business.name);
    doc.fontSize(11).font('Helvetica').fillColor('#555')
      .text(`Report for ${formatDate(r.from)} to ${formatDate(r.to)} (${r.days} days)`)
      .text(`Generated ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })} SAST`);
    if (r.business.vatRegistered && r.business.vatNumber) doc.text(`VAT no. ${r.business.vatNumber}`);
    doc.fillColor('#000').moveDown();

    section(doc, 'Revenue received');
    keyValues(doc, [
      ['Total received', formatRand(r.revenue.totalReceivedCents)],
      ['Cash', formatRand(r.revenue.cashCents)],
      ['EFT (verified)', formatRand(r.revenue.eftCents)],
      ['Refunds paid', formatRand(r.revenue.refundsCents)],
      ['EFT awaiting verification', formatRand(r.revenue.pendingEftCents)],
      ...(r.business.vatRegistered ? [['VAT included', formatRand(r.revenue.vatCents)] as [string, string]] : []),
    ]);

    section(doc, 'Occupancy');
    keyValues(doc, [
      ['Occupancy', `${r.occupancy.occupancyPercent}%`],
      ['Room nights sold', `${r.occupancy.roomNightsSold} of ${r.occupancy.roomNightsAvailable}`],
      ['Average nightly rate', formatRand(r.occupancy.averageRateCents)],
      ['Bookings made / cancelled', `${r.bookings.created} / ${r.bookings.cancelled}`],
    ]);
    table(doc, ['Room', 'Nights', 'Occupancy', 'Value'], [150, 80, 90, 120],
      r.occupancy.rooms.map((x) => [x.name, String(x.nights), `${x.occupancyPercent}%`, formatRand(x.earnedCents)]));

    section(doc, 'Outstanding balances');
    if (r.outstanding.length === 0) doc.fontSize(10).text('Nothing outstanding.').moveDown();
    else
      table(doc, ['Booking', 'Guest', 'Dates', 'Paid', 'Outstanding'], [70, 140, 130, 85, 90],
        r.outstanding.map((o) => [o.reference, o.guestName, `${formatDate(o.checkIn)}–${formatDate(o.checkOut)}`, formatRand(o.paidCents), formatRand(o.outstandingCents)]));

    section(doc, 'Payments');
    if (r.payments.length === 0) doc.fontSize(10).text('No payments in this period.');
    else
      table(doc, ['Date', 'Booking', 'Guest', 'Type', 'Method', 'Amount', 'Verified'], [62, 62, 120, 55, 45, 85, 50],
        r.payments.map((p) => [
          formatDate(p.paymentDate),
          p.bookingReference,
          p.guestName,
          LABELS[p.type],
          LABELS[p.method],
          formatRand(p.type === 'REFUND' ? -p.amountCents : p.amountCents),
          p.verified ? 'Yes' : 'No',
        ]));

    doc.end();
  });
}

function section(doc: PDFKit.PDFDocument, title: string) {
  if (doc.y > 720) doc.addPage();
  doc.moveDown(0.5).fontSize(13).font('Helvetica-Bold').text(title, 40).font('Helvetica').moveDown(0.3);
}

function keyValues(doc: PDFKit.PDFDocument, rows: [string, string][]) {
  doc.fontSize(10);
  for (const [k, v] of rows) {
    const y = doc.y;
    doc.text(k, 40, y, { width: 220 });
    doc.text(v, 260, y, { width: 150, align: 'right' });
  }
  doc.moveDown();
}

function table(doc: PDFKit.PDFDocument, headers: string[], widths: number[], rows: string[][]) {
  const draw = (cells: string[], bold: boolean) => {
    if (doc.y > 780) doc.addPage();
    const y = doc.y;
    let x = 40;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    let maxH = 0;
    cells.forEach((c, i) => {
      const h = doc.heightOfString(c, { width: widths[i] - 6 });
      maxH = Math.max(maxH, h);
      doc.text(c, x, y, { width: widths[i] - 6 });
      x += widths[i];
    });
    doc.y = y + maxH + 4;
  };
  draw(headers, true);
  doc.moveTo(40, doc.y - 2).lineTo(40 + widths.reduce((a, b) => a + b, 0), doc.y - 2).strokeColor('#ccc').stroke();
  for (const row of rows) draw(row, false);
  doc.x = 40;
  doc.moveDown();
}
