"use client";

import { useState } from "react";

import { AdminDatePicker } from "@/components/admin/date/AdminDatePicker";

type AdminDatePickerFieldProps = {
  name: string;
  defaultValue?: string;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
};

export function AdminDatePickerField({
  name,
  defaultValue = "",
  min,
  max,
  placeholder,
  disabled,
  className,
  buttonClassName,
}: AdminDatePickerFieldProps) {
  const [value, setValue] = useState(defaultValue);

  return (
    <>
      <input type="hidden" name={name} value={value} readOnly />
      <AdminDatePicker
        value={value}
        onChange={setValue}
        min={min}
        max={max}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        buttonClassName={buttonClassName}
      />
    </>
  );
}
