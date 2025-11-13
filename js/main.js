document.addEventListener('DOMContentLoaded', function() {
    const file1Input = document.getElementById('file1');
    const file2Input = document.getElementById('file2');
    const preview1 = document.getElementById('preview1');
    const preview2 = document.getElementById('preview2');
    const nextButton = document.getElementById('nextButton');

    function handleFileSelect(file, previewElement) {
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                previewElement.src = e.target.result;
                previewElement.style.display = 'block';
                previewElement.previousElementSibling.style.display = 'none';
            };
            reader.readAsDataURL(file);
        }
        checkIfBothImagesUploaded();
    }

    function checkIfBothImagesUploaded() {
        if (file1Input.files.length > 0 && file2Input.files.length > 0) {
            nextButton.disabled = false;
        } else {
            nextButton.disabled = true;
        }
    }

    file1Input.addEventListener('change', function(e) {
        handleFileSelect(this.files[0], preview1);
    });

    file2Input.addEventListener('change', function(e) {
        handleFileSelect(this.files[0], preview2);
    });

    nextButton.addEventListener('click', function() {
        // Здесь будет логика обработки загруженных изображений
        alert('Изображения успешно загружены! Эта функция находится в разработке.');
    });

    // Drag and drop functionality
    ['upload1', 'upload2'].forEach(id => {
        const dropZone = document.getElementById(id);
        const fileInput = dropZone.querySelector('.file-input');

        dropZone.addEventListener('dragover', function(e) {
            e.preventDefault();
            this.style.borderColor = '#007bff';
        });

        dropZone.addEventListener('dragleave', function(e) {
            e.preventDefault();
            this.style.borderColor = '#ccc';
        });

        dropZone.addEventListener('drop', function(e) {
            e.preventDefault();
            this.style.borderColor = '#ccc';
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                fileInput.files = e.dataTransfer.files;
                const event = new Event('change');
                fileInput.dispatchEvent(event);
            }
        });
    });
});