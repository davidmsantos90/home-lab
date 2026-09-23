import { useState, useCallback } from "react";
import type { HvSelectProps } from "@hitachivantara/uikit-react-core";

// @ts-ignore
type SelectProps<TData> = HvSelectProps<TData, true>;

interface UseFakeUnselectReturn<TData> extends SelectProps<TData> {
  multiple: true;
}

const useFakeUnselect = <TData,>({
  placeholder,
  defaultValue,
  onChange: onChangeProp,
}: {
  placeholder?: string;
  defaultValue?: TData;
  onChange?: (value: TData | undefined) => void;
}): UseFakeUnselectReturn<TData> => {
  const [value, setValue] = useState<TData[]>(
    defaultValue ? [defaultValue] : [],
  );
  const [open, setOpen] = useState(false);

  const onChange = useCallback(
    (_: unknown, newValue: TData[]) => {
      let selectedValue: TData | undefined = undefined;

      // If newValue has more elements than before, find the newly added one
      if (newValue.length > value.length) {
        selectedValue = newValue.find((v) => !value.includes(v));
      }
      // Otherwise, it was a deselection

      setValue(selectedValue ? [selectedValue] : []);

      setOpen(false);
      onChangeProp?.(selectedValue);
    },
    [value, onChangeProp],
  );

  const onOpenChange = useCallback((isOpen: boolean) => {
    setOpen(isOpen);
  }, []);

  const renderValue: SelectProps<TData>["renderValue"] = useCallback((values) => {
      return !values.length ? placeholder : values[0].label;
    }, []);
    
  return {
    multiple: true,
    open,
    value,
    renderValue,
    onChange,
    onOpenChange,
  };
};

export default useFakeUnselect;
