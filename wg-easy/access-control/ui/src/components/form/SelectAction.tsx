import { useMemo, useCallback, type FC } from "react";
import { HvSelect, type HvSelectProps } from "@hitachivantara/uikit-react-core";
import type { AccessControlRule } from "../../api/apiSchemas";

type Action = AccessControlRule["action"];
interface ActionOption {
  label: string;
  value: Action;
}

type SelectProps = HvSelectProps<Action>;
interface Props extends Omit<SelectProps, "name" | "label" | "multiple" | "onChange"> {
  onChange?: (value: Action | null) => void;
}

const SelectAction: FC<Props> = (props) => {
  const { value, onChange, ...others } = props;

  const options = useMemo<ActionOption[]>(() => [
    { label: "Allow", value: "allow" },
    { label: "Deny", value: "deny" },
    { label: "Drop", value: "drop" },
    { label: "Reject", value: "reject" },
  ], []);

  const onActionChange: SelectProps["onChange"] = useCallback((_, action) => {
    onChange?.(action);
  }, [onChange]);
  

  return (
    <HvSelect
      label="Action"
      name="action"
      placeholder="Select..."
      value={value}
      options={options}
      onChange={onActionChange}
      {...others}
    />
  )
};

export default SelectAction;
