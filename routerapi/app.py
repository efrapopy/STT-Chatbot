from flask import Flask, request, jsonify
import speech_recognition as sr
import tempfile

app = Flask(__name__)

@app.route('/stt', methods=['POST'])
def stt():
    # Cek apakah ada file
    if 'file' not in request.files:
        return jsonify({'error': 'no file field'}), 400

    file = request.files['file']

    # Simpan ke file sementara
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp:
        file.save(temp.name)
        audio_path = temp.name

    # Gunakan SpeechRecognition
    recognizer = sr.Recognizer()
    with sr.AudioFile(audio_path) as source:
        audio_data = recognizer.record(source)
        try:
            text = recognizer.recognize_google(audio_data, language='id-ID')
            return jsonify({'text': text})
        except sr.UnknownValueError:
            return jsonify({'error': 'tidak bisa mengenali ucapan'}), 400
        except sr.RequestError as e:
            return jsonify({'error': f'error dari Google API: {e}'}), 500


if __name__ == '__main__':
    app.run(debug=True)
