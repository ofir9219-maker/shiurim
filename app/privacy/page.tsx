export const metadata = { title: "Política de privacidad" };

const updated = "18 de noviembre de 2026";

export default function Privacy() {
  return (
    <article className="legal" style={{ maxWidth: 760, margin: "0 auto", padding: "2.5rem 1.25rem 6rem", lineHeight: 1.7 }}>
      <h1>Política de privacidad</h1>
      <p><em>Última actualización: {updated}</em></p>

      <p>
        Este sitio («Shiurim — ברכות שר לשמחה») publica clases de Torá con su audio y transcripción, y ofrece búsqueda y un
        asistente de preguntas. Esta política explica qué datos se usan y para qué.
      </p>

      <h2>Datos de los visitantes</h2>
      <ul>
        <li>No se requieren cuentas ni se recogen nombres, correos ni datos personales de los visitantes.</li>
        <li>
          Las conversaciones del chat, la posición del reproductor y las preferencias (tema, tamaño de letra) se guardan
          solo en el navegador del visitante (almacenamiento local) y no en nuestros servidores.
        </li>
        <li>
          El texto de las preguntas al chat se envía a un proveedor de IA (OpenAI) únicamente para generar la respuesta. No
          se usa para identificar al visitante.
        </li>
        <li>El proveedor de hosting puede registrar datos técnicos estándar (por ejemplo dirección IP) en sus registros.</li>
      </ul>

      <h2>Acceso a Google Drive (solo administración)</h2>
      <p>
        El administrador del sitio puede conectar su propia cuenta de Google para automatizar la publicación de nuevas
        clases. Con ese permiso, la aplicación únicamente:
      </p>
      <ul>
        <li>lee la lista de archivos de audio de la carpeta de clases indicada y descarga esos audios;</li>
        <li>cambia el nombre de esos archivos y crea en la misma carpeta el archivo de transcripción (.md).</li>
      </ul>
      <p>
        No se accede a otros archivos, no se comparten datos de Google con terceros salvo para transcribir el audio (Fal) y
        corregir la transcripción (OpenAI), y no se venden ni usan con fines publicitarios. El token de acceso se guarda
        cifrado en el servidor y el administrador puede revocarlo en cualquier momento desde{" "}
        <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.
      </p>
      <p>
        El uso y la transferencia de información recibida de las API de Google cumplen la{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>,
        incluidos los requisitos de uso limitado (Limited Use).
      </p>

      <h2>Servicios de terceros</h2>
      <ul>
        <li>Railway (hosting), Cloudflare R2 (almacenamiento de audio), Google Drive (origen de las clases).</li>
        <li>Fal (transcripción de audio) y OpenAI (corrección de transcripciones, búsqueda y chat).</li>
        <li>Sefaria (textos de la Guemará, consulta pública).</li>
      </ul>

      <h2>Contacto</h2>
      <p>Para cualquier consulta sobre privacidad, escribe al administrador del sitio a través del correo de contacto de la cuenta de Google del proyecto.</p>
    </article>
  );
}
