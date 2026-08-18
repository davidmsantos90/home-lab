import type { FC, PropsWithChildren, ReactNode } from "react";
import {
  HvCard,
  HvCardContent,
  HvCardHeader,
} from "@hitachivantara/uikit-react-core";

interface Props extends PropsWithChildren {
  title: string;
  description: string;
  icon: ReactNode;
}

const SectionCard: FC<Props> = (props) => {
  const { title, description, icon, children } = props;

  return (
    <HvCard>
      <HvCardHeader title={title} subheader={description} icon={icon} />
      <HvCardContent className="flex flex-col gap-4">{children}</HvCardContent>
    </HvCard>
  );
};

export default SectionCard;
