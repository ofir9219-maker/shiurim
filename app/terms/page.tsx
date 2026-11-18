export const metadata = { title: "Términos de uso" };

export default function Terms() {
  return (
    <article className="legal" style={{ maxWidth: 760, margin: "0 auto", padding: "2.5rem 1.25rem 6rem", lineHeight: 1.7 }}>
      <h1>Términos de uso</h1>
      <p>
        El contenido de este sitio (audios, transcripciones y resúmenes de clases de Torá) se ofrece con fines de estudio.
        Las transcripciones y respuestas del asistente se generan con ayuda de herramientas automáticas y pueden contener
        errores; ante cualquier duda, la fuente es el audio original y los textos citados.
      </p>
      <p>No está permitido usar el sitio para fines ilícitos ni intentar acceder a sus áreas de administración.</p>
      <p>Ver también la <a href="/privacy">política de privacidad</a>.</p>
    </article>
  );
}
