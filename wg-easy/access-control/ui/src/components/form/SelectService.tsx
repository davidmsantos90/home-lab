import { useMemo, useCallback, type FC } from "react";
import { HvSelect, type HvSelectProps } from "@hitachivantara/uikit-react-core";
import {
  useGetAccessControlServices,
} from "../../api/apiComponents";

type SelectProps = HvSelectProps<string, true>;
interface Props extends Omit<SelectProps, "name" | "label" | "multiple" | "onChange"> {
  onChange?: (value: string[]) => void;
}

const SelectService: FC<Props> = (props) => {
  const { value, onChange, ...others } = props;

  const { data: services = [] } = useGetAccessControlServices({});
  const options = useMemo(() => services.map((service) => ({ label: service.name, value: service.name })), [services]);

  const onServiceChange: SelectProps["onChange"] = useCallback((_, service) => {
    onChange?.(service);
  }, [onChange]);

  const renderValue: SelectProps["renderValue"] = useCallback((values) => {
    if (values.length === 0) {
      return "Select a service...";
    }

    return values.map((value) => value.label).join(", ");
  }, []);

  return (
    <HvSelect
      label="Service"
      name="service"
      value={value}
      multiple
      options={options}
      onChange={onServiceChange}
      renderValue={renderValue}
      {...others}
    />
  )
};

export default SelectService;
