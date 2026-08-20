import { type FC, useMemo, useRef, useState, useCallback } from "react";

const useForm = <DATA extends object>(initialValue: DATA) => {
  const initialValueRef = useRef<DATA>(initialValue);
  const [form, setForm] = useState<DATA>(initialValueRef.current);

  const setField = useCallback((key: keyof DATA, value: unknown) => {
    console.log("setField", key, value, typeof value);
    setForm((previous) => ({ ...previous, [key]: value }));
  }, []);

  const getField = useCallback((key: keyof DATA) => form[key], [form]);

  const isDirty = useMemo(() => {
    return Object.keys(form).some((key) => {
      const name = key as keyof DATA;

      const { [name]: currentValue } = form;
      const { [name]: initialValue } = initialValueRef.current;

      return JSON.stringify(currentValue) !== JSON.stringify(initialValue);
    });
  }, [form]);

  return useMemo(
    () => ({
      form,
      isDirty,
      setField,
      getField,
    }),
    [form, isDirty, setField, getField],
  );
};

export default useForm;
