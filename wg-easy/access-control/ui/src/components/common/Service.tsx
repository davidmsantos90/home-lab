import { type FC, useState, useCallback } from "react";
import { HvIconButton, HvIconContainer, HvInput, HvListContainer, HvListItem, HvSwitch, HvTypography } from "@hitachivantara/uikit-react-core";
import { PlusSquareIcon } from "@phosphor-icons/react";
import { AccessControlRuleService, AccessControlServiceEntry } from "../../api/apiSchemas";
import SelectProtocol from "../form/SelectProtocol";
import InputPort from "../form/InputPort";

interface Props {
  value?: AccessControlRuleService;
  edit?: boolean;
  onChange?: (value: AccessControlRuleService) => void;
}

const Service: FC<Props> = props => {
  const { value, edit = false, onChange } = props;

  const [editing, setEditing] = useState(false);

  const [name, setName] = useState(value?.name ?? "");
  const [entries, setEntries] = useState<Partial<AccessControlServiceEntry>[]>(value?.entries ?? []);
  
  const onAddEntry = useCallback(() => {
    const newEntry = { port: undefined, protocol: undefined };
    
    setEntries(prev => [newEntry, ...prev]);
    setEditing(true);
  }, [onChange]);

  const onEntryChange = useCallback((index: number, newEntry: Partial<AccessControlServiceEntry>) => {
    setEntries(prev => prev.map((entry, i) => i === index ? { ...entry, ...newEntry } : entry));
  }, []);

  return (
    <>
      {edit ? (
        <HvInput value={name} onChange={(_, value) => setName(value)}
        />
      ) : (
        <HvTypography variant="label">{name}</HvTypography>
      )}
      <HvListContainer className="flex flex-wrap gap-2">
        {edit && (
          <HvListItem className="flex-shrink-0">
            <HvIconButton title="Add Service" onClick={onAddEntry} disabled={editing}>
              <HvIconContainer size="md">
                <PlusSquareIcon weight="bold" />
              </HvIconContainer>
            </HvIconButton>
          </HvListItem>
        )}

        {entries.map(({ port, protocol, bidirectional = false }, index) => (
          <HvListItem key={`${port}-${protocol}`} className="flex-shrink-0 grid grid-cols-3 gap-xs p-sm">
            <div className="sm:col-span-1 flex items-center gap-xs">
              {edit ? (
                <SelectProtocol
                  defaultValue={protocol}
                  onChange={newProtocol => {
                    onEntryChange(index, { protocol: newProtocol });
                  }}
                />
              ) : (
                <>
                  <HvTypography variant="label">Protocol:</HvTypography>
                  <HvTypography>{protocol}</HvTypography>
                </>
              )}
            </div>

            <div className="sm:col-span-1 flex items-center gap-xs">
              {edit ? (
                <InputPort
                  defaultValue={port}
                  onChange={newPort => {
                    onEntryChange(index, { port: newPort });
                  }}
                />
              ) : (
                <>
                  <HvTypography variant="label">Port:</HvTypography>
                  <HvTypography>{port}</HvTypography>
                </>
              )}
            </div>

            <div className="sm:col-span-1 flex items-center gap-xs">
              {edit ? (
                <HvSwitch
                  labelPosition="left"
                  label="Bidirectional"
                  checked={bidirectional}
                />
            
              ) : (
                <>
                  <HvTypography variant="label">Bidirectional:</HvTypography>
                  <HvTypography>{bidirectional ? "Yes" : "No"}</HvTypography>
                </>
              )}
            </div>
          </HvListItem>
        ))}

      </HvListContainer>
    </>
  );
};

export default Service;
