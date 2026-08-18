import type { FC, ReactNode } from "react";
import { ArrowFatLinesRightIcon } from "@phosphor-icons/react/dist/icons/ArrowFatLinesRight";
import {
  HvCard,
  HvCardContent,
  HvCardHeader,
  HvIconContainer,
  HvTooltip,
  HvTypography,
} from "@hitachivantara/uikit-react-core";

interface Props {
  label: string;
  value: string | number;
  helper: string;
  icon?: ReactNode;
}

const StatCard: FC<Props> = (props) => {
  const { label, value, helper, icon } = props;

  return (
    <HvCard statusColor="positive">
      <HvCardHeader
        className="flex-row-reverse items-center gap-xxs"
        title={
          <HvTooltip title={helper}>
            <div className="flex items-center">
              <HvTypography
                variant="label"
                className="color-positive uppercase text-nowrap"
              >
                {label}
              </HvTypography>
              <HvIconContainer size="sm" color="positive">
                <ArrowFatLinesRightIcon />
              </HvIconContainer>
              <HvTypography variant="title3" className="color-positive">
                {value}
              </HvTypography>
            </div>
          </HvTooltip>
        }
        icon={
          icon && (
            <HvIconContainer color="positive" size="md">
              {icon}
            </HvIconContainer>
          )
        }
      />
    </HvCard>
  );
};

export default StatCard;
