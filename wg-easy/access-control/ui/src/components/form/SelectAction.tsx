import { useMemo, type FC } from "react";
import { HvSelect, type HvSelectProps } from "@hitachivantara/uikit-react-core";

import type { AccessControlAction } from "../../types/accessControl";
import useFakeUnselect from "../../hooks/useFakeUnselect";

interface Props extends Omit<
  HvSelectProps<AccessControlAction, true>,
  "name" | "label" | "multiple" | "onChange" | "value" | "defaultValue"
> {
  defaultValue?: AccessControlAction;
  onChange?: (value: AccessControlAction | undefined) => void;
}

const SelectAction: FC<Props> = (props) => {
  const { defaultValue, onChange, ...others } = props;

  const unselectProps = useFakeUnselect<AccessControlAction>({
    placeholder: "Select an action...",
    defaultValue,
    onChange,
  });

  const options = useMemo(
    () => [
      { label: "Allow", value: "allow" as const },
      { label: "Deny", value: "deny" as const },
      { label: "Drop", value: "drop" as const },
      { label: "Reject", value: "reject" as const },
    ],
    [],
  );

  return (
    <HvSelect
      label="Action"
      name="action"
      options={options}
      {...others}
      {...unselectProps}
    />
  );
};

export default SelectAction;
