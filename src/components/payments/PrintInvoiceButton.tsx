"use client";

export default function PrintInvoiceButton({ className }: { className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      Print Invoice
    </button>
  );
}
