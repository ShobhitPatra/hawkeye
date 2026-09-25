export function FieldRefusal({ id, message }: { id: string; message: string | undefined }) {
  if (message === undefined) return null;
  return (
    <p id={id} className="hk-help hk-refusal hk-arrive" role="alert">
      {message}
    </p>
  );
}
