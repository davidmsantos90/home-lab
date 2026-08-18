import { useCallback } from "react";
import { HvTag, HvTypography } from "@hitachivantara/uikit-react-core";

interface Props<T> {
  title: string;
  tags?: T[];
  computeTagLabel?: (tag: T) => string;
}

const CatalogTags = <T,>(props: Props<T>) => {
  const { title, tags, computeTagLabel } = props;

  const getTagLabel = useCallback(
    (tag: T) => {
      if (computeTagLabel) {
        return computeTagLabel(tag);
      }

      return String(tag);
    },
    [computeTagLabel],
  );

  if (!tags || tags.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <HvTypography variant="label" className="uppercase tracking-wide text-sm">
        {title}
      </HvTypography>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <HvTag
            key={getTagLabel(tag)}
            label={
              <HvTypography variant="captionLabel">
                {getTagLabel(tag)}
              </HvTypography>
            }
            type="categorical"
            size="sm"
          />
        ))}
      </div>
    </div>
  );
};

export default CatalogTags;
