import {
  green,
  mergeTheme,
  pentaho,
  pink,
  rose,
  sky,
  slate,
  teal,
  theme,
  violet,
  yellow,
} from "@hitachivantara/uikit-styles";

const cyberpunkLightPage = "#f3f0ff";
const cyberpunkLightPageSecondary = "#ede9fe";
const cyberpunkDarkPage = "#020617";
const cyberpunkDarkPageSecondary = "#050816";
const cyberpunkDarkContainer = "#0a1022";
const cyberpunkDarkContainerSecondary = "#121a31";
const cyberpunkNavBackground = "#070d1d";

const cyberpunkTheme = mergeTheme(pentaho, {
  name: "cyberpunk",
  defaultColorMode: "dark",
  colors: {
    light: {
      primary: teal[600],
      primaryStrong: teal[700],
      primaryDeep: teal[900],
      primarySubtle: teal[100],
      primaryDimmed: teal[50],
      accent: pink[600],
      accentStrong: pink[700],
      accentDeep: pink[900],
      accentSubtle: pink[100],
      accentDimmed: pink[50],
      positive: green[600],
      positiveStrong: green[700],
      positiveDeep: green[900],
      positiveSubtle: green[100],
      positiveDimmed: green[50],
      warning: yellow[600],
      warningStrong: yellow[700],
      warningDeep: yellow[900],
      warningSubtle: yellow[100],
      warningDimmed: yellow[50],
      negative: rose[600],
      negativeStrong: rose[700],
      negativeDeep: rose[900],
      negativeSubtle: rose[100],
      negativeDimmed: rose[50],
      info: sky[600],
      infoStrong: sky[700],
      infoDeep: sky[900],
      infoSubtle: sky[100],
      infoDimmed: sky[50],
      accentBorder: pink[500],
      positiveBorder: green[500],
      warningBorder: yellow[500],
      negativeBorder: rose[500],
      infoBorder: sky[500],
      text: slate[900],
      textSubtle: slate[700],
      textDisabled: slate[400],
      textDimmed: slate[600],
      textLight: "#ffffff",
      textDark: slate[950],
      border: teal[300],
      borderSubtle: teal[100],
      borderStrong: pink[500],
      borderDisabled: slate[200],
      bgPage: cyberpunkLightPage,
      bgPageSecondary: cyberpunkLightPageSecondary,
      bgContainer: "#ffffff",
      bgContainerSecondary: "#faf5ff",
      bgHover: theme.alpha(teal[500], 0.08),
      bgDisabled: slate[100],
      bgOverlay: theme.alpha(slate[950], 0.72),
      dimmer: slate[950],
      shad1: theme.alpha(violet[500], 0.16),
      shadow: `0 12px 30px ${theme.alpha(violet[500], 0.12)}`,
    },
    dark: {
      primary: teal[400],
      primaryStrong: teal[300],
      primaryDeep: teal[600],
      primarySubtle: teal[200],
      primaryDimmed: teal[900],
      accent: pink[400],
      accentStrong: pink[300],
      accentDeep: pink[600],
      accentSubtle: pink[200],
      accentDimmed: pink[950],
      positive: green[400],
      positiveStrong: green[300],
      positiveDeep: green[600],
      positiveSubtle: green[200],
      positiveDimmed: green[950],
      warning: yellow[400],
      warningStrong: yellow[300],
      warningDeep: yellow[600],
      warningSubtle: yellow[200],
      warningDimmed: yellow[950],
      negative: rose[400],
      negativeStrong: rose[300],
      negativeDeep: rose[600],
      negativeSubtle: rose[200],
      negativeDimmed: rose[950],
      info: sky[400],
      infoStrong: sky[300],
      infoDeep: sky[600],
      infoSubtle: sky[200],
      infoDimmed: sky[950],
      accentBorder: pink[400],
      positiveBorder: green[400],
      warningBorder: yellow[400],
      negativeBorder: rose[400],
      infoBorder: sky[400],
      text: "#f5f3ff",
      textSubtle: "#cbd5e1",
      textDisabled: slate[500],
      textDimmed: slate[400],
      textLight: "#ffffff",
      textDark: slate[950],
      border: theme.alpha(teal[400], 0.4),
      borderSubtle: theme.alpha(teal[300], 0.16),
      borderStrong: pink[400],
      borderDisabled: slate[800],
      bgPage: cyberpunkDarkPage,
      bgPageSecondary: cyberpunkDarkPageSecondary,
      bgContainer: cyberpunkDarkContainer,
      bgContainerSecondary: cyberpunkDarkContainerSecondary,
      bgHover: theme.alpha(teal[400], 0.12),
      bgDisabled: "#161b2d",
      bgOverlay: theme.alpha(slate[950], 0.92),
      dimmer: slate[950],
      shad1: theme.alpha(violet[500], 0.24),
      shadow: `0 0 0 1px ${theme.alpha(teal[300], 0.18)}, 0 18px 40px ${theme.alpha(
        slate[950],
        0.55,
      )}`,
    },
  },
  components: {
    HvVerticalNavigation: {
      classes: {
        root: {
          color: "#f5f3ff",
          backgroundColor: cyberpunkNavBackground,
          boxShadow: `inset -1px 0 0 0 ${theme.alpha(teal[300], 0.32)}, 0 0 36px ${theme.alpha(
            violet[500],
            0.12,
          )}`,
          "& > :not(nav:first-of-type)": {
            borderTop: `1px solid ${theme.alpha(teal[300], 0.22)}`,
          },
        },
        slider: {
          "& > div:first-of-type": {
            borderBottom: `1px solid ${theme.alpha(teal[300], 0.22)}`,
          },
        },
      },
    },
    HvVerticalNavigationAction: {
      classes: {
        action: {
          borderRadius: "10px",
          "&:hover, &:focus": {
            backgroundColor: theme.alpha(teal[400], 0.12),
            boxShadow: `0 0 0 1px ${theme.alpha(teal[300], 0.35)}`,
          },
        },
      },
    },
    HvVerticalNavigationSlider: {
      classes: {
        root: {
          borderRadius: "10px",
          "&.HvIsFocused": {
            backgroundColor: theme.alpha(teal[400], 0.14),
          },
          "&.HvListItem-interactive:not(.HvListItem-disabled):not(.HvListItem-selected):hover":
            {
              backgroundColor: theme.alpha(teal[400], 0.14),
            },
        },
        listItemSelected: {
          background: `linear-gradient(90deg, ${theme.alpha(teal[400], 0.22)}, ${theme.alpha(
            pink[500],
            0.22,
          )})`,
          boxShadow: `inset 0 0 0 1px ${theme.alpha(teal[300], 0.4)}, 0 0 18px ${theme.alpha(
            violet[500],
            0.12,
          )}`,
        },
        listItemFocus: {
          background: theme.alpha(teal[400], 0.14),
        },
      },
    },
    HvVerticalNavigationTreeViewItem: {
      classes: {
        content: {
          borderRadius: "10px",
          ".HvVerticalNavigationTreeViewItem-selected>&": {
            background: `linear-gradient(90deg, ${theme.alpha(teal[400], 0.22)}, ${theme.alpha(
              pink[500],
              0.22,
            )})`,
            boxShadow: `inset 0 0 0 1px ${theme.alpha(teal[300], 0.4)}, 0 0 18px ${theme.alpha(
              violet[500],
              0.12,
            )}`,
          },
          ":not(.HvVerticalNavigationTreeViewItem-disabled>&):not(.HvVerticalNavigationTreeViewItem-selected>&)":
            {
              "&:hover, &:focus-visible, &.focus-visible": {
                background: theme.alpha(teal[400], 0.14),
              },
            },
          ".HvVerticalNavigationTreeViewItem-focused>&": {
            background: theme.alpha(teal[400], 0.14),
          },
        },
      },
    },
    HvCard: {
      classes: {
        root: {
          backgroundImage: `linear-gradient(135deg, ${theme.alpha(teal[400], 0.08)}, ${theme.alpha(
            pink[500],
            0.06,
          )})`,
          boxShadow: `0 0 0 1px ${theme.alpha(teal[300], 0.22)}, 0 14px 36px ${theme.alpha(
            slate[950],
            0.45,
          )}`,
        },
      },
    },
  },
});

export default cyberpunkTheme;
