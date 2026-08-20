import { useMemo, useCallback, type FC } from "react";
import { HvSelect, type HvSelectProps } from "@hitachivantara/uikit-react-core";
import useGetAliases from "../../hooks/useGetAliases";

type SelectProps = HvSelectProps<string, true>;
interface Props extends Omit<SelectProps, "name" | "label" | "multiple" | "onChange"> {
  onChange?: (value: string[]) => void;
}

const SelectDestination: FC<Props> = (props) => {
  const { value, onChange, ...others } = props;

  const aliases = useGetAliases();
  const options = useMemo(() => aliases.map((alias) => ({ label: alias.name, value: alias.name })), [aliases]);

  const onDestinationChange: SelectProps["onChange"] = useCallback((_, destination) => {
    onChange?.(destination);
  }, [onChange]);

  const renderValue: SelectProps["renderValue"] = useCallback((values) => {
    if (values.length === 0) {
      return "Select a destination...";
    }

    return values.map((value) => value.label).join(", ");
  }, []);

  return (
    <HvSelect
      label="Destination"
      name="destination"
      value={value}
      multiple
      options={options}
      onChange={onDestinationChange}
      renderValue={renderValue}
      {...others}
    />
  )
};

export default SelectDestination;
