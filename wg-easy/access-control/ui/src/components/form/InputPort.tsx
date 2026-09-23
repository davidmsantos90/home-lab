import { useCallback, type FC } from "react";
import { HvInput, type HvInputProps } from "@hitachivantara/uikit-react-core";

interface Props extends Omit<
  HvInputProps,
  "label" | "name" | "onChange" | "type"
> {
  onChange?: (value: number | undefined) => void;
}
type InputChangeHandler = NonNullable<HvInputProps["onChange"]>;

const InputPort: FC<Props> = (props) => {
  const { onChange, ...others } = props;

  const onPortChange = useCallback<InputChangeHandler>(
    (_, value) => {
      if (value === "") {
        onChange?.(undefined);
        return;
      }

      const port = Number(value);
      if (Number.isInteger(port) && port >= 1 && port <= 65535) {
        onChange?.(port);
      }
    },
    [onChange],
  );

  return (
    <HvInput
      label="Port"
      name="port"
      type="number"
      inputProps={{ min: 1, max: 65535 }}
      placeholder="Pick a value between 1 and 65535"
      onChange={onPortChange}
      {...others}
    />
  );
};

export default InputPort;
