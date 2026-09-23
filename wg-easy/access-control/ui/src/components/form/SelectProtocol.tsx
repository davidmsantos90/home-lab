import { useMemo, type FC } from "react";
import { HvSelect, type HvSelectProps } from "@hitachivantara/uikit-react-core";

import type { NullableProtocol, Protocol } from "../../types/accessControl";
import useFakeUnselect from "../../hooks/useFakeUnselect";

interface Props extends Omit<
  HvSelectProps<Protocol, true>,
  "name" | "label" | "multiple" | "onChange" | "value" | "defaultValue"
> {
  defaultValue: NullableProtocol;
  onChange?: (value: NullableProtocol) => void;
}

const SelectProtocol: FC<Props> = (props) => {
  const { defaultValue, onChange, ...others } = props;

  const unselectProps = useFakeUnselect<Protocol>({
    placeholder: "Select a protocol...",
    defaultValue: defaultValue,
    onChange,
  });

  const options = useMemo(
    () => [
      { label: "TCP", value: "tcp" as const },
      { label: "UDP", value: "udp" as const },
    ],
    [],
  );

  return (
    <HvSelect
      label="Protocol"
      name="protocol"
      options={options}
      {...others}
      {...unselectProps}
    />
  );
};

export default SelectProtocol;
