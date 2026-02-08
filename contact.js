document.addEventListener('DOMContentLoaded', () => {
    const contactForm = document.querySelector('.contact-form');

    if (contactForm) {
        contactForm.addEventListener('submit', (e) => {
            e.preventDefault();

            // Get form values
            const name = document.getElementById('name').value;
            const userEmail = document.getElementById('email').value;
            const message = document.getElementById('message').value;

            // My email address
            const myEmail = "ali.valiyev.7262@gmail.com";

            // Construct email subject and body
            const subject = `İletişim Formu: ${name}`;
            const body = `Ad: ${name}\nEmail: ${userEmail}\n\nMesaj:\n${message}`;

            // Create mailto link
            // Note: We cannot "automatically" send an email from the user's Gmail without their login/permission via API.
            // The best static-site method is to open their default email client with the fields pre-filled.
            const mailtoLink = `mailto:${myEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

            // specific handling for Gmail web interface if they don't have a default client?
            // No, standard mailto is best practice.
            window.location.href = mailtoLink;
        });
    }
});
