# Use a lightweight, optimized official Python image
FROM python:3.11-slim

# Set the processing workspace inside the container
WORKDIR /app

# Copy dependency ledger first to leverage Docker layer caching speeds
COPY requirements.txt .

# Install dependencies clean with no local caching baggage
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the local backend directory contents into the container workspace
COPY . .

# Expose port 8080 to match Google Cloud Run's native routing framework
EXPOSE 8080

# Launch the production-ready high-performance Uvicorn ASGI server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]