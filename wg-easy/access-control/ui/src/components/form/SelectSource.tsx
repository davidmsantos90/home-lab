import { useMemo, useCallback, type FC } from "react";
import { HvSelect, type HvSelectProps } from "@hitachivantara/uikit-react-core";
import useGetAliases from "../../hooks/useGetAliases";

type SelectProps = HvSelectProps<string, true>;
interface Props extends Omit<SelectProps, "name" | "label" | "multiple" | "onChange"> {
  onChange?: (value: string[]) => void;
}

const SelectSource: FC<Props> = (props) => {
  const { value, onChange, ...others } = props;

  const aliases = useGetAliases();
  const options = useMemo(() => aliases.map((alias) => ({ label: alias.name, value: alias.name })), [aliases]);

  const onSourceChange: SelectProps["onChange"] = useCallback((_, source) => {
    onChange?.(source);
  }, [onChange]);

  const renderValue: SelectProps["renderValue"] = useCallback((values) => {
    if (values.length === 0) {
      return "Select a source...";
    }

    return values.map((value) => value.label).join(", ");
  }, []);

  return (
    <HvSelect
      label="Source"
      name="source"
      value={value}
      multiple
      options={options}
      onChange={onSourceChange}
      renderValue={renderValue}
      {...others}
    />
  )
};

export default SelectSource;
