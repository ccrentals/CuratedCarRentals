"use client";

import { useState } from "react";

import { AdminMonthPicker } from "@/components/admin/date/AdminMonthPicker";

type AdminMonthPickerFieldProps = {
  name: string;
  defaultValue?: string;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
};

export function AdminMonthPickerField({
  name,
  defaultValue = "",
  min,
  max,
  placeholder,
  disabled,
  className,
  inputClassName,
}: AdminMonthPickerFieldProps) {
  const [value, setValue] = useState(defaultValue);

  return (
    <AdminMonthPicker
      name={name}
      value={value}
      onChange={setValue}
      min={min}
      max={max}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      inputClassName={inputClassName}
    />
  );
}
