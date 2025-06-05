import Joi from 'joi';

const videoClipSchema = Joi.object({
  url: Joi.string().uri().required()
    .pattern(/^https:\/\/.*\.(mp4|mov|avi|mkv)$/, 'Video clip URL must be a valid HTTPS URL pointing to a video file'),
  duration: Joi.number().min(1).max(60).default(8)
    .messages({ 'number.min': 'Video clip duration must be between 1 and 60 seconds', 'number.max': 'Video clip duration must be between 1 and 60 seconds' })
});

const assFileSchema = Joi.object({
  url: Joi.string().uri().required()
    .pattern(/^https:\/\/.*\.ass$/, 'ASS file URL must be a valid HTTPS URL pointing to an .ass file')
});

export const processVideoRequestSchema = Joi.object({
  videoClips: Joi.array()
    .items(videoClipSchema)
    .min(1)
    .max(50)
    .required()
    .messages({ 'array.min': 'Must provide between 1 and 50 video clips', 'array.max': 'Must provide between 1 and 50 video clips' }),
  
  assFile: assFileSchema.required(),
  
  songUrl: Joi.string().uri().required()
    .pattern(/^https:\/\/.*\.(mp3|wav|aac|m4a)$/, 'Song URL must be a valid HTTPS URL pointing to an audio file'),
  
  songId: Joi.string()
    .pattern(/^[a-zA-Z0-9-]+$/)
    .min(3)
    .max(50)
    .required()
    .messages({ 
      'string.pattern.base': 'Song ID must contain only letters, numbers, and hyphens',
      'string.min': 'Song ID must be between 3-50 characters',
      'string.max': 'Song ID must be between 3-50 characters'
    }),
  
  songTitle: Joi.string()
    .max(200)
    .optional()
    .messages({ 'string.max': 'Song title must be less than 200 characters' }),
  
  outputAspectRatio: Joi.string()
    .valid('9:16', '16:9')
    .required()
    .messages({ 'any.only': 'Output aspect ratio must be either "9:16" or "16:9"' }),
  
  transitionDuration: Joi.number()
    .min(0.1)
    .max(5.0)
    .default(0.5)
    .messages({ 
      'number.min': 'Transition duration must be between 0.1 and 5.0 seconds',
      'number.max': 'Transition duration must be between 0.1 and 5.0 seconds'
    })
});

export const validateProcessVideoRequest = (data: any) => {
  const { error, value } = processVideoRequestSchema.validate(data, {
    abortEarly: false,
    stripUnknown: true
  });
  
  if (error) {
    const details = error.details.map((detail: any) => ({
      field: detail.path.join('.'),
      message: detail.message
    }));
    
    throw new Error(`Validation failed: ${details.map((d: any) => `${d.field}: ${d.message}`).join('; ')}`);
  }
  
  return value;
}; 