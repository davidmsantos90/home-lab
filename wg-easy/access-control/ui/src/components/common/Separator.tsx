import type { FC } from "react";

interface Props {
  label?: string;
}

const Separator: FC<Props> = ({ label = "or" }) => (
  <div
    className="sm:col-span-4 flex items-center gap-3"
    role="separator"
  >
    <div className="flex-1 border-t b-positive" />
    <span className="text-secondary text-sm color-positive font-bold">
      {label}
    </span>
    <div className="flex-1 border-t b-positive" />
  </div>
);

export default Separator;
