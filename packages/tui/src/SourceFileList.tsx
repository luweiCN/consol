/** @jsxImportSource @opentui/solid */
import type { DevSession } from "@consol/core";
import { selectedBoxBackground, theme } from "./theme";

export type SourceFileListProps = {
  readonly session: DevSession | undefined;
  readonly fallback: string;
  readonly selectedSourceTargetIndex: number;
  readonly onSourceFileSelect?: (index: number) => void;
};

export function SourceFileList(props: SourceFileListProps) {
  return (
    <>
      {props.session === undefined || props.session.sourceTargets.length === 0 ? (
        <text content={props.fallback} />
      ) : (
        <scrollbox
          id="source-file-scrollbox"
          width="100%"
          height="100%"
          scrollY
          scrollX={false}
          verticalScrollbarOptions={theme.scrollbar.vertical}
          contentOptions={{ flexDirection: "column" }}
        >
          {props.session.sourceTargets.map((sourceTarget, index) => (
            <box
              id={`source-file-${index}`}
              height={1}
              {...selectedBoxBackground(props.selectedSourceTargetIndex === index)}
              onMouseDown={() => {
                props.onSourceFileSelect?.(index);
              }}
            >
              <text content={`${props.selectedSourceTargetIndex === index ? "›" : " "} ${sourceTarget.target}`} />
            </box>
          ))}
        </scrollbox>
      )}
    </>
  );
}
